import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { PNG } = require('pngjs');

const identity = [1,0,0,0,1,0,0,0,1];
// Column-major Blockbench rotation X=-90 degrees: the wolf's body lies flat.
const wolfRest = [1,0,0,0,0,-1,0,1,0];
const cfg = { exportAsEquipment:true,equipmentTarget:'wolf_body',scale:1 };
const mul = (m,p) => [0,1,2].map(r=>m[r]*p[0]+m[3+r]*p[1]+m[6+r]*p[2]);
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const add = (a,b) => a.map((v,i)=>v+b[i]);
const norm = a => Math.hypot(...a);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const transpose = m => [m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
const flip = p => [p[0],-p[1],p[2]];
function setup(groups=[]) {
  const handlers=new Map(),timers=[];
  const loaded=loadObjcubedWithContext({globals:{Buffer,Group:{all:groups},Project:{uuid:'project'},
    Codecs:{project:{on(k,fn){handlers.set(k,fn);},removeListener(k){handlers.delete(k);}}},
    setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},
  }});
  return {...loaded,handlers,flush(){for(const fn of timers.splice(0))fn();}};
}
function group(basis=wolfRest) {return {uuid:'wolf-body',name:'Body',origin:[0,10,2],parent:'root',
  objcubed_equipment_part:'body',objcubed_equipment_rest:{target:'wolf_body',part:'body',basis:[...basis]}};}
function encode(api,binding) {
  const result={tw:16,ty:8,rawBuf:Buffer.alloc(16*8*4,17),nfaces:1,faceToEquipmentBinding:[binding]};
  const layer=api.planAnimalLayers(result,cfg)[0];
  const png=PNG.sync.read(api.encodeAnimalLayer(result,cfg,layer,[0]));
  const floats=Array.from({length:99},(_,i)=>png.data.readFloatLE(result.tw*result.ty*4+i*4));
  return {png,floats,result};
}
function shaderPosition(descriptor,actual,position,pivot) {
  const [q0,q1,q3,n]=[descriptor.slice(4,7),descriptor.slice(7,10),descriptor.slice(10,13),descriptor.slice(13,16)];
  const u=sub(q0,q1),v=sub(q0,q3),au=sub(actual[0],actual[1]),av=sub(actual[0],actual[2]);
  const scale=(norm(au)/norm(u)+norm(av)/norm(v))/2;
  const frame=[...u.map(x=>x/norm(u)),...v.map(x=>x/norm(v)),...n.map(x=>x/norm(n))];
  let an=cross(au,av); if(an.reduce((s,x,i)=>s+x*actual[3][i],0)<0)an=an.map(x=>-x);
  const actualFrame=[...au.map(x=>x/norm(u)),...av.map(x=>x/norm(v)),...an.map(x=>x/norm(an)*scale)];
  const transform=p=>mul(actualFrame,mul(transpose(frame),p));
  return add(sub(actual[0],transform(q0)),transform(sub(position,pivot)));
}
function close(actual,expected){actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],5));}

describe('assembled equipment templates retain a fixed rest basis',()=>{
  it('reads a fixed template basis without cancelling later author group rotations',()=>{
    const g=group();g.rotation=[-70,12,3];
    const {api}=setup([g]);
    const binding=api.equipmentBindingOfElement({parent:g},cfg);
    expect(binding.restBasis).toEqual(wolfRest);
    expect(binding.pivot).toEqual([0,10/16,2/16]);
    expect(binding.restBasis).not.toBe(g.objcubed_equipment_rest.basis);
  });

  it.each([1,1.1,4])('wolf body in assembled pose matches native reconstruction at rest scale %s',scale=>{
    const g=group(wolfRest.map(v=>v*scale)),{api}=setup([g]);
    const binding=api.equipmentBindingOfElement({parent:g},cfg),{floats,result,png}=encode(api,binding);
    const carrier=api.EQUIPMENT_CARRIERS.wolf_body.bindings.body.quads[0];
    const nativeRest=p=>flip(mul(g.objcubed_equipment_rest.basis,flip(p)));
    const nativePivot=[.2,.7,-.1];
    const actual=[carrier.q0,carrier.q1,carrier.q3].map(p=>add(nativePivot,nativeRest(p)));
    actual.push(nativeRest(carrier.normal));
    const local=[.17,-.22,.31],sourceBB=add(binding.pivot,mul(g.objcubed_equipment_rest.basis,flip(local)));
    close(shaderPosition(floats,actual,flip(sourceBB),floats.slice(96)),add(nativePivot,nativeRest(local)));
    // Ordinary item bytes and texture/animation data remain unchanged.
    expect(png.data.subarray(16*4,result.rawBuf.length)).toEqual(result.rawBuf.subarray(16*4));
  });

  it('keeps an artist-added rotation after the fixed rest transform',()=>{
    const g=group(),{api}=setup([g]),binding=api.equipmentBindingOfElement({parent:g},cfg),{floats}=encode(api,binding);
    const q=api.EQUIPMENT_CARRIERS.wolf_body.bindings.body.quads[0];
    const rest=p=>flip(mul(wolfRest,flip(p))),pivot=[.2,.7,-.1];
    const actual=[q.q0,q.q1,q.q3].map(p=>add(pivot,rest(p)));actual.push(rest(q.normal));
    const extra=[0,1,0,-1,0,0,0,0,1],p=[.17,-.22,.31];
    const drawn=mul(extra,mul(wolfRest,flip(p)));
    close(shaderPosition(floats,actual,flip(add(binding.pivot,drawn)),floats.slice(96)),add(pivot,flip(drawn)));
  });

  it('follows a changed native pose after removing only the template rest basis',()=>{
    const g=group(),{api}=setup([g]),binding=api.equipmentBindingOfElement({parent:g},cfg),{floats}=encode(api,binding);
    const q=api.EQUIPMENT_CARRIERS.wolf_body.bindings.body.quads[0],angle=.7;
    const nativeMotion=[Math.cos(angle),0,-Math.sin(angle),0,1,0,Math.sin(angle),0,Math.cos(angle)];
    const moved=p=>mul(nativeMotion,flip(mul(wolfRest,flip(p)))),pivot=[.2,.7,-.1];
    const actual=[q.q0,q.q1,q.q3].map(p=>add(pivot,moved(p)));actual.push(moved(q.normal));
    const p=[.17,-.22,.31],drawn=add(binding.pivot,mul(wolfRest,flip(p)));
    close(shaderPosition(floats,actual,flip(drawn),floats.slice(96)),add(pivot,moved(p)));
  });

  it('leaves legacy pivot-only carrier descriptors byte-identical',()=>{
    const {api}=setup(),binding={part:'body',pivot:[1,2,3],key:'old'};
    const {floats}=encode(api,binding),quads=api.EQUIPMENT_CARRIERS.wolf_body.bindings.body.quads;
    const expected=quads.flatMap(q=>[...q.uv,...q.q0,...q.q1,...q.q3,...q.normal]).concat([1,-2,3]);
    floats.forEach((v,i)=>expect(v).toBe(Math.fround(expected[i])));
  });

  it.each([
    {target:'horse_body',part:'body',basis:identity},
    {target:'wolf_body',part:'head',basis:identity},
    {target:'wolf_body',part:'body',basis:[1,0,0,0,2,0,0,0,1]},
    {target:'wolf_body',part:'body',basis:[-1,0,0,0,1,0,0,0,1]},
    {target:'wolf_body',part:'body',basis:[1,0,0,1,1,0,0,0,1]},
    {target:'wolf_body',part:'body',basis:[1,0,0,0,1,0,0,0,NaN]},
  ])('rejects mismatched or invalid rest transforms before encoding: %j',rest=>{
    const g=group();g.objcubed_equipment_rest=rest;const {api}=setup([g]);
    expect(()=>api.equipmentBindingOfElement({parent:g},cfg)).toThrow(/rest|template|basis/i);
  });

  it('round-trips fixed transforms independently of the editor current group rotation',()=>{
    const g=group(),f=setup([g]);f.api.installProjectPersistence();
    const event={model:{}};f.handlers.get('compile')(event);
    expect(event.model.objcubed.equipmentRestTransforms).toEqual({'wolf-body':g.objcubed_equipment_rest});
    g.objcubed_equipment_rest={};g.rotation=[-55,0,0];
    f.handlers.get('parse')({model:JSON.parse(JSON.stringify(event.model))});f.flush();
    expect(g.objcubed_equipment_rest).toEqual({target:'wolf_body',part:'body',basis:wolfRest});
    expect(g.rotation).toEqual([-55,0,0]);
    g.objcubed_equipment_rest.basis[0]=7;
    expect(event.model.objcubed.equipmentRestTransforms['wolf-body'].basis[0]).toBe(1);
  });
});
