import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {PNG} from 'pngjs';
import {buildArmorBvhPack} from './build-armor-bvh.mjs';
const out=path.resolve(process.argv[2]||'work/armor-bvh-tests');fs.mkdirSync(out,{recursive:true});
const u24=(d,i)=>d[i]*65536+d[i+1]*256+d[i+2];
const put=(d,i,n)=>d.set([n>>>16&255,n>>>8&255,n&255,255],i);
function texture({seed=0,part=2,face=3,easing=0,frames=4,uvShift=0}={}){
 const W=32,positionRow=5,ph=Math.ceil(frames*12/W),uh=Math.ceil(frames*8/W),uvRow=positionRow+ph,indexRow=uvRow+uh;
 const png=new PNG({width:W,height:16}),d=png.data;
 d.set([12,34,56,253]);d.set([0,W,0,255],4);d[28]=2;d[29]=4;put(d,12,frames);d[15]=1;put(d,16,40);d[19]=64|(easing<<4);d[20]=ph>>>8;d[21]=ph;d[22]=uh>>>8;d[30]=uh;
 d.set([0,0,part,1],32);d.set([65,83,49,255],26*4);d.set([part,face,0,255],27*4);
 for(let i=3*W*4;i<5*W*4;i+=4)d.set([80,140,210,255],i);
 for(let f=0;f<frames;f++)for(let c=0;c<4;c++){
  const v=f*4+c,coords=[(c===0||c===3?.5:-.5)+seed*.13, c<2?.5:-.5,seed*.06+f*.02+(c===3?.2:0)];
  for(let a=0;a<3;a++)put(d,(positionRow*W+v*3+a)*4,Math.round((coords[a]+128)*65536));
  for(let a=0;a<2;a++)put(d,(uvRow*W+v*2+a)*4,Math.round(((a===0?(c<2?.2:.8):(c%2?.3:.7))+uvShift)*65535));
  put(d,(indexRow*W+v*2)*4,v);put(d,(indexRow*W+v*2+1)*4,v);
 }
 return png;
}
let cases=0;
function test(name,options={},mutate=()=>{},expected=1){
 const source=path.join(out,name+'-source'),dest=path.join(out,name+'-out');fs.mkdirSync(source);fs.writeFileSync(source+'/pack.mcmeta',JSON.stringify({pack:{min_format:[97,1],max_format:[97,1],description:'AS2 regression'}}));
 const layers=[0,1,2].map(i=>({texture:`test:quad${i}`,dyeable:{color_when_undyed:16777215}}));const pngs=[texture({seed:99,...options}),texture({seed:1,...options}),texture({seed:2,face:5,...options})];
 mutate(pngs,layers);fs.mkdirSync(source+'/assets/test/equipment',{recursive:true});fs.mkdirSync(source+'/assets/test/textures/entity/equipment/humanoid',{recursive:true});
 fs.writeFileSync(source+'/assets/test/equipment/test.json',JSON.stringify({layers:{humanoid:layers}}));const bytes=pngs.map(p=>PNG.sync.write(p));for(let i=0;i<3;i++)fs.writeFileSync(source+`/assets/test/textures/entity/equipment/humanoid/quad${i}.png`,bytes[i]);
 const m=buildArmorBvhPack(source,dest,{validateRays:192});assert.equal(m.converted.length,expected,name);const after=JSON.parse(fs.readFileSync(dest+'/assets/test/equipment/test.json')).layers.humanoid;assert.deepEqual(after[0],layers[0]);assert.equal(after.length,expected?2:3);
 for(let i=0;i<3;i++){assert(fs.readFileSync(source+`/assets/test/textures/entity/equipment/humanoid/quad${i}.png`).equals(bytes[i]));assert(fs.readFileSync(dest+`/assets/test/textures/entity/equipment/humanoid/quad${i}.png`).equals(bytes[i]));}
 if(expected){const group=m.converted[0],p=PNG.sync.read(fs.readFileSync(dest+'/'+group.texture));assert.deepEqual(Array.from(p.data.subarray(26*4,27*4)),[65,83,50,255]);assert.equal(u24(p.data,29*4),3);assert.equal(group.validation.mismatches,0);assert.equal(group.sources.length,2);assert.equal(group.exactVerifiedPositionAndUvTexels,options.frames===1?40:160);if(options.frames===1)assert.equal(u24(p.data,30*4),0);}
 cases++;return m;
}
for(let easing=0;easing<4;easing++)for(const part of [2,3])test(`easing${easing}-part${part}`,{easing,part});
test('static',{frames:1});
test('translucent',{},p=>{p[2].data[3*32*4+3]=254;},0);
test('different-clock',{},p=>{p[2].data[18]++;},0);
test('different-shadow',{},p=>{p[2].data[24]^=128;},0);
test('different-row1',{},p=>{p[2].data[32*4+7]++;},0);
test('different-emission',{},p=>{p[2].data[20*4+1]=1;},0);
test('different-part',{},p=>{p[2].data[27*4]=3;},0);
test('different-inner',{},p=>{p[2].data[27*4+2]=1;},0);
test('different-layer-properties',{},(p,l)=>{l[2].dyeable.color_when_undyed=123;},0);
const duplicate=test('coplanar-uv-conflict',{},p=>{p[2]=texture({seed:1,face:5,uvShift:.01});},0);assert(duplicate.skipped.some(x=>x.reason.includes('different UVs')));
console.log(`${cases} AS2 merge/fallback cases passed; byte preservation and CPU BVH parity included.`);
