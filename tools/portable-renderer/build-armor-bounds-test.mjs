import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {buildArmorBoundsPack} from './build-armor-bounds.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'objcubed-armor-bounds-'));
const put=(d,p,v)=>{d[p*4]=v>>>16;d[p*4+1]=v>>>8;d[p*4+2]=v;d[p*4+3]=255;};
const get=(d,p)=>d[p*4]*65536+d[p*4+1]*256+d[p*4+2];
try{
  const source=path.join(root,'source'),relative='assets/test/textures/entity/equipment/humanoid/test.png';
  fs.mkdirSync(path.dirname(path.join(source,relative)),{recursive:true});fs.writeFileSync(path.join(source,'pack.mcmeta'),'{}');
  const p=new PNG({width:32,height:16});for(let i=0;i<32*16;i++)p.data[i*4+3]=255;
  p.data.set([12,34,56,253,0,32,0,255,0,0,0,255,0,0,4,1,0,0,40,112,0,2,0,255,28,0,2,255,1,4,1,255]);
  p.data.set([0,0,0,1],8*4);p.data[(3*32+10)*4+3]=127;
  const shape=[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]],shift=[-100,100,100,-100];
  for(let f=0;f<4;f++)for(let v=0;v<4;v++){
    const id=f*4+v;for(let a=0;a<3;a++)put(p.data,4*32+id*3+a,Math.round((shape[v][a]+(a===0?shift[f]:0)+128)*65536));
    put(p.data,7*32+id*2,id);put(p.data,7*32+id*2+1,0);
  }
  const original=PNG.sync.write(p);fs.writeFileSync(path.join(source,relative),original);
  const output=path.join(root,'out'),report=buildArmorBoundsPack(source,output);assert.equal(report.converted.length,1);
  const q=PNG.sync.read(fs.readFileSync(path.join(output,relative)));assert.equal(q.height,32);
  assert.deepEqual([...q.data.subarray(23*4,24*4)],[65,66,49,255]);assert.equal(get(q.data,24),16);assert.equal(get(q.data,25),1);
  assert.equal(q.data[3],253);assert.equal(q.data[(3*32+10)*4+3],127);
  const row=16*32;assert.ok(get(q.data,row)/32768-256 < -130);assert.ok(get(q.data,row+3)/32768-256 > 130);
  for(let i=0;i<p.data.length;i++)if(i<23*4||i>=26*4)assert.equal(q.data[i],p.data[i]);
  for(let i=0;i<6;i++)assert.equal(q.data[(row+i)*4+3],255);
  assert.deepEqual(fs.readFileSync(path.join(source,relative)),original);
  const again=buildArmorBoundsPack(output,path.join(root,'again'));assert.equal(again.converted.length,0);assert.match(again.skipped[0].reason,/already present/);
  const narrow=new PNG({width:24,height:16});p.data.copy(narrow.data,0,0,narrow.data.length);narrow.data[5]=24;
  const narrowBytes=PNG.sync.write(narrow);fs.writeFileSync(path.join(source,relative),narrowBytes);
  const skipped=path.join(root,'narrow'),r2=buildArmorBoundsPack(source,skipped);assert.equal(r2.converted.length,0);assert.match(r2.skipped[0].reason,/too narrow/);
  assert.deepEqual(fs.readFileSync(path.join(skipped,relative)),narrowBytes);
  console.log('PASS: AB1 format, all-frame/Catmull overshoot, opaque bounds, preserved transparency/geometry/source, repeated conversion, narrow fallback');
}finally{fs.rmSync(root,{recursive:true,force:true});}
