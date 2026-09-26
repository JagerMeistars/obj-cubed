// Self-contained format, preservation, and CPU ray parity regression.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {buildBvhPack} from './build-bvh.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(),'objcubed-bvh-'));
const texture = 'assets/test/textures/item/fixture.png';
const modelFile = 'assets/test/models/item/fixture.json';
const put = (d,p,n) => {d[p*4]=n>>16;d[p*4+1]=n>>8;d[p*4+2]=n;d[p*4+3]=255;};
const get = (d,p) => d[p*4]*65536+d[p*4+1]*256+d[p*4+2];
try {
  const source = path.join(root,'source');
  fs.mkdirSync(path.dirname(path.join(source,texture)),{recursive:true});
  fs.mkdirSync(path.dirname(path.join(source,modelFile)),{recursive:true});
  fs.writeFileSync(path.join(source,'pack.mcmeta'),'{}');
  const png = new PNG({width:32,height:16});
  for (let p=0;p<png.width*png.height;p++) png.data[p*4+3]=255;
  png.data.set([12,34,56,255, 0,32,0,255, 0,0,0,255, 0,0,4,1,
    0,0,40,112, 0,3,0,255, 28,0,2,255, 1,8,1,255]);
  png.data.set([0,0,0,2,0,1,0,2],2*32*4);
  const positions = [[-100,-100,0],[100,-100,0],[100,100,0],[-100,100,0]];
  for (let f=0;f<4;f++) for (let v=0;v<8;v++) {
    const i=f*8+v, p=positions[v&3].map((x,a) => a===2 ? (v<4?f*3:20-f*2) : x * [1,-1,-1,1][f]);
    for (let a=0;a<3;a++) put(png.data,4*32+i*3+a,Math.round((p[a]+128)*65536));
    put(png.data,8*32+i*2,i);put(png.data,8*32+i*2+1,0);
  }
  const inputBytes=PNG.sync.write(png);
  fs.writeFileSync(path.join(source,texture),inputBytes);
  const model={textures:{'0':'test:item/fixture'},elements:[0,1].map(i=>({from:[8,8,8],to:[24,24,8],faces:{north:{uv:[i+.1,2.1,i+.9,2.9],texture:'#0'}}})),display:{fixed:{rotation:[1,2,3]}}};
  const modelBytes=JSON.stringify(model);fs.writeFileSync(path.join(source,modelFile),modelBytes);
  const dest=path.join(root,'converted'), report=buildBvhPack(source,dest,{validateRays:512});
  assert.equal(report.converted.length,1);assert.equal(report.converted[0].nodeCount,3);
  assert.equal(report.converted[0].validation.mismatches,0);
  const out=PNG.sync.read(fs.readFileSync(path.join(dest,texture)));
  assert.equal(out.height,32);assert.equal(out.data[3],255);
  assert.deepEqual([...out.data.subarray(19*4,20*4)],[66,86,72,255]);
  assert.deepEqual([...out.data.subarray(20*4,21*4)],[66,70,49,255]);
  assert.equal(get(out.data,16),16);assert.equal(get(out.data,17),3);assert.equal(get(out.data,18),16);
  assert.equal(get(out.data,21),17);
  assert.equal(report.converted[0].segmentBounds.bytes,4*3*8);
  assert.equal(report.converted[0].segmentBounds.validation.mismatches,0);
  for(let i=0;i<png.data.length;i++) if(i<16*4||i>=22*4) assert.equal(out.data[i],png.data[i],`preserved byte ${i}`);
  for(let p=16*32;p<16*32+3*8;p++)assert.equal(out.data[p*4+3],255);
  for(let p=17*32;p<17*32+4*3*2;p++)assert.equal(out.data[p*4+3],255);
  const result=JSON.parse(fs.readFileSync(path.join(dest,modelFile),'utf8'));
  assert.equal(result.elements.length,1);assert.deepEqual(result.display,model.display);
  assert.deepEqual(result.elements[0].faces.north.uv,[.1,1.05,.9,1.45]);
  assert.deepEqual(fs.readFileSync(path.join(source,texture)),inputBytes);
  assert.equal(fs.readFileSync(path.join(source,modelFile),'utf8'),modelBytes);
  assert.throws(()=>buildBvhPack(source,dest),/must not exist/);
  for(let easing=0;easing<3;easing++) {
    png.data[19]=(png.data[19]&~48)|(easing<<4);
    fs.writeFileSync(path.join(source,texture),PNG.sync.write(png));
    const check=buildBvhPack(source,path.join(root,`easing${easing}`),{validateRays:128});
    assert.equal(check.converted[0].segmentBounds.validation.declaredEasing,easing);
    assert.equal(check.converted[0].segmentBounds.validation.mismatches,0);
  }

  // Any non-opaque pixel in the actual color region keeps both resources intact.
  png.data[(3*32+7)*4+3]=254;
  const translucent=PNG.sync.write(png);fs.writeFileSync(path.join(source,texture),translucent);
  const skipped=path.join(root,'skipped'), r2=buildBvhPack(source,skipped,{validateRays:4});
  assert.equal(r2.converted.length,0);assert.match(r2.skipped[0].reason,/non-opaque/);
  assert.deepEqual(fs.readFileSync(path.join(skipped,texture)),translucent);
  assert.equal(fs.readFileSync(path.join(skipped,modelFile),'utf8'),modelBytes);
  fs.writeFileSync(path.join(source,texture),inputBytes);
  model.elements[1].light_emission=15;
  const glowing=JSON.stringify(model);fs.writeFileSync(path.join(source,modelFile),glowing);
  const mixed=path.join(root,'mixed'),r3=buildBvhPack(source,mixed,{validateRays:4});
  assert.equal(r3.converted.length,0);assert.match(r3.skipped[0].reason,/differing per-face/);
  assert.deepEqual(fs.readFileSync(path.join(mixed,texture)),inputBytes);
  assert.equal(fs.readFileSync(path.join(mixed,modelFile),'utf8'),glowing);
  const narrow=new PNG({width:16,height:16});
  for(let p=0;p<16*16;p++)narrow.data[p*4+3]=255;
  narrow.data.set([12,34,56,255,0,16,0,255,0,0,0,255,0,0,1,1,
    0,0,40,64,0,1,0,255,28,0,2,255,1,4,1,255]);
  const narrowBytes=PNG.sync.write(narrow);fs.writeFileSync(path.join(source,texture),narrowBytes);
  const narrowOut=path.join(root,'narrow'),r4=buildBvhPack(source,narrowOut,{validateRays:4});
  assert.equal(r4.converted.length,0);assert.match(r4.skipped[0].reason,/texture width/);
  assert.deepEqual(fs.readFileSync(path.join(narrowOut,texture)),narrowBytes);
  assert.equal(fs.readFileSync(path.join(narrowOut,modelFile),'utf8'),glowing);
  if(process.argv[2]) {
    const fixtureOutput=path.resolve(process.argv[2]);
    assert.equal(fs.existsSync(fixtureOutput),false,'fixture output must not exist');
    fs.mkdirSync(fixtureOutput,{recursive:true});
    for(let easing=0;easing<4;easing++)fs.cpSync(easing===3?dest:path.join(root,`easing${easing}`),path.join(fixtureOutput,`easing${easing}`),{recursive:true});
  }
  console.log('PASS: opaque conversion, all four segment easing bounds, cyclic overshoot, CPU ray parity, byte preservation, UV scaling, source immutability, existing destination rejection, narrow-texture/translucent/mixed-emission fallbacks');
} finally {fs.rmSync(root,{recursive:true,force:true});}
