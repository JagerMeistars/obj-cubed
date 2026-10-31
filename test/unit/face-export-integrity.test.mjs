import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const SOURCE=fs.readFileSync(new URL('../../objcubed.js',import.meta.url),'utf8')
  .replace('module.exports.__test = {','module.exports.__test = { getObjContents,');
const POSITIONS='v 0 0 0\nv 1 0 0\nv 0 1 0\n';
const UVS='vt 0.125 0.8125\nvt 0.8125 0.75\nvt 0.3125 0.125\n';
function fixture({mode='quads',fail=false,hasSetting=true}={}) {
  const settings={language:{value:'en'}};
  if(hasSetting)settings.obj_face_export_mode={value:mode};
  const seen=[],outliner={root:[],elements:[]};
  class Mesh{}; Mesh.all=[];
  const animation={select(){},length:1,snapping:1};
  const context={module:{exports:{}},console:{log(){},warn(){},error(){}},require,setTimeout,
    BBPlugin:{register(){}},settings,Outliner:outliner,Mesh,Cube:class{},Group:class{},
    Timeline:{time:7},Animator:{preview(){}},Animation:{all:[animation]},
    Codecs:{obj:{compile(){
      const active=settings.obj_face_export_mode?.value ?? 'both';seen.push(active);
      if(fail)throw new Error('codec failed');
      // Blockbench 5.2.2's quads mode adds a 4th corner after writing only
      // three UVs, then computes nbVertexUvs - vertices.length + i + 1.
      const face=active==='quads'?'f 1/0 2/1 3/2 1/0':'f 1/1 2/2 3/3';
      return {obj:POSITIONS+UVS+face,mtl:''};
    }}},
  };
  vm.createContext(context);vm.runInContext(SOURCE,context);
  return {api:context.module.exports.__test,context,settings,seen};
}
const config={animationEnabled:false};
describe('OBJ export preserves triangle surfaces regardless of editor preference',()=>{
  it('uses native triangles and quads for static exports, then restores quads preference',async()=>{
    const f=fixture(),output=await f.api.getObjContents(config);
    expect(f.seen).toEqual(['both']);
    const data=f.api.buildVertexData(output.objs,null,null,null).data;
    expect(data.vertices.map(v=>data.uvs[v[1]])).toEqual([[.125,.8125],[.8125,.75],[.3125,.125],[.3125,.125]]);
    expect(f.settings.obj_face_export_mode.value).toBe('quads');
  });
  it('preserves source triangle UVs in every baked frame and restores settings between callbacks',async()=>{
    const f=fixture();let progress=0;
    const output=await f.api.getObjContents({...config,animationEnabled:true,animationIndex:0,animFps:1,animStart:0,animEnd:1},()=>{
      progress++;expect(f.settings.obj_face_export_mode.value).toBe('quads');
    });
    expect(f.seen).toEqual(['both','both']);expect(progress).toBe(2);
    for(const obj of output.objs)expect(f.api.parseObj(obj,0).faces[0]).toEqual([[0,0],[1,1],[2,2]]);
    expect(f.context.Timeline.time).toBe(7);
  });
  it.each([false,true])('restores a nondefault preference on codec failure (animated=%s)',async animated=>{
    const f=fixture({mode:'tris',fail:true});
    await expect(f.api.getObjContents({...config,animationEnabled:animated,animationIndex:0,animFps:1,animStart:0,animEnd:1})).rejects.toThrow('codec failed');
    expect(f.seen).toEqual(['both']);expect(f.settings.obj_face_export_mode.value).toBe('tris');
    expect(f.context.Outliner.root).toEqual([]);
  });
  it('supports hosts without the OBJ face setting',async()=>{
    const f=fixture({hasSetting:false});
    const output=await f.api.getObjContents(config);
    expect(f.api.parseObj(output.objs[0],0).faces).toHaveLength(1);
    expect(f.settings.obj_face_export_mode).toBeUndefined();
  });
});

function atlasFixture(names=['same.png','same.png']) {
  const f=fixture(),colors={a:[255,0,0,0],b:[0,255,0,255]};
  class Image {
    set src(v){this.source=v;queueMicrotask(()=>this.onload());}
    get naturalWidth(){return 16;}get naturalHeight(){return 16;}
  }
  Object.assign(f.context,{Buffer,process,Image,
    Texture:{all:names.map((name,i)=>({uuid:['a','b'][i],name,source:['a','b'][i]}))},
    document:{createElement(){let image;const ctx={drawImage(im){image=im;},getImageData(){
      return {width:16,height:16,data:new Uint8Array(Array.from({length:256},()=>colors[image.source]).flat())};
    }};return {getContext(){return ctx;}};}},
  });
  return f;
}
const atlasConfig={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],
  duration:0,autoplay:false,easing:0,interpolation:0,noshadow:false,autorotate:0,visibility:7,displaySlots:{},
  flipuv:false,useAtlas:true,atlasTexIndices:[0,1],texAnimEnabled:false};
const twoMaterials=POSITIONS+UVS+'usemtl m_a\nf 1/1 2/2 3/3\nusemtl m_b\nf 1/1 2/2 3/3';
function expectBothTextures(result) {
  const h=result.rawBuf[6]*256+result.rawBuf[28];
  expect(h).toBe(32);
  const textureStart=3*result.tw*4;
  expect(Array.from(result.rawBuf.slice(textureStart,textureStart+4))).toEqual([255,0,0,0]);
  const second=textureStart+16*result.tw*4;
  expect(Array.from(result.rawBuf.slice(second,second+4))).toEqual([0,255,0,255]);
}
describe('atlas material identity does not turn opaque faces transparent',()=>{
  it('uses Blockbench UUIDs when two materials share a texture filename',async()=>{
    const f=atlasFixture();
    expectBothTextures(await f.api.buildOutput({...atlasConfig},[twoMaterials],
      'newmtl m_a\nmap_Kd same.png\nnewmtl m_b\nmap_Kd same.png'));
  });
  it('resolves remaining UUIDs when only part of the MTL filenames match',async()=>{
    const f=atlasFixture(['first.png','second.png']);
    expectBothTextures(await f.api.buildOutput({...atlasConfig},[twoMaterials],
      'newmtl m_a\nmap_Kd first.png\nnewmtl m_b\nmap_Kd renamed.png'));
  });
  it('keeps filename fallback for materials without Blockbench UUID names',async()=>{
    const f=atlasFixture(['first.png','second.png']);
    expectBothTextures(await f.api.buildOutput({...atlasConfig},[twoMaterials.replace('m_a','paint').replace('m_b','metal')],
      'newmtl paint\nmap_Kd first.png\nnewmtl metal\nmap_Kd second.png'));
  });
  it('resolves a UUID first used in a later animation frame',async()=>{
    const f=atlasFixture(['first.png','second.png']);
    const first=twoMaterials.replace('usemtl m_b','usemtl m_a');
    expectBothTextures(await f.api.buildOutput({...atlasConfig},[first,twoMaterials],
      'newmtl m_a\nmap_Kd first.png'));
  });
});

describe('native profile animation retains a fixed set of visible faces',()=>{
  const profileConfig={...atlasConfig,skinEnabled:true,skinSlot:0,autoplay:true,duration:20,easing:1,resourcePackDir:'/rp'};
  function profileFixture(){
    const f=atlasFixture();
    Object.assign(f.context.Texture.all[0],{width:64,height:64,frameCount:1});
    return f;
  }
  it.each(['ordinary to profile','profile to ordinary'])('rejects %s material changes before producing a partial model',async direction=>{
    const f=profileFixture();
    const changed=direction==='ordinary to profile'
      ? twoMaterials.replace('usemtl m_b','usemtl m_a')
      : twoMaterials.replace('usemtl m_a','usemtl m_b');
    await expect(f.api.buildOutput({...profileConfig},[twoMaterials,changed],'').then(()=>null)).rejects.toThrow(/Profile face material changes/);
  });
  it('retains both surfaces and per-frame UVs when only pose and UV coordinates change',async()=>{
    const f=profileFixture();
    const changed=twoMaterials.replace('v 1 0 0','v 2 0 0').replace('vt 0.125 0.8125','vt 0.25 0.8125');
    const result=await f.api.buildOutput({...profileConfig},[twoMaterials,changed],'');
    expect(result.nfaces).toBe(2);
    expect(result.nativeSkin.faces).toBe(1);
    expect(result.nativeSkin.ordinaryFaces).toBe(1);
    expect(result.nativeSkin.vertices).toHaveLength(8);
    const skin=result.nativeSkin;
    expect(skin.uvs[skin.vertices[0][1]][0]).toBeCloseTo(.125,4);
    expect(skin.uvs[skin.vertices[4][1]][0]).toBeCloseTo(.25,4);
    expect(skin.positions[skin.vertices[1][0]][0]).toBe(1);
    expect(skin.positions[skin.vertices[5][0]][0]).toBe(2);
  });
});
