import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const {loadColorPlugin}=createRequire(import.meta.url)('../helpers/color-plugin.cjs');
const cfg={texIndex:0,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],autoplay:false,easing:1,visibility:7,displaySlots:{}};
const obj='o shell\nusemtl m_u\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 .25\nvt .5 .5\nf 1/1 2/1 3/1 4/1\nf 1/1 2/1 3/1';

it('encodes Ambient independently from full brightness, without exporting unused normals',async()=>{
  const {api}=loadColorPlugin();
  for(const mode of ['flat','smooth','ambient']) {
    const out=await api.buildOutput({...cfg,shadingMode:mode},[obj],'');
    const flags=out.rawBuf[out.tw*4+2];
    expect(!!(flags&32)).toBe(mode==='ambient');
    expect(!!(flags&8)).toBe(mode!=='ambient');
    expect(out.rawBuf[6*4]&128).toBe(0);
  }
});

it('keeps ordinary profile faces ambient while preserving explicit face and whole-model glow',()=>{
  const {api}=loadColorPlugin();
  for(const glow of [false,true]) {
    const skin=api.nativeSkinData({...cfg,shadingMode:'ambient',skinEnabled:true,noshadow:glow},[obj],new Set(['m_u']),[0,15],1);
    expect(skin.unlit).toEqual([glow?1:2,1]);
    expect(skin.normals).toBeUndefined();
  }
});
