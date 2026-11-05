import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadColorPlugin}=require('../helpers/color-plugin.cjs');

const cfg={texIndex:0,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:0,
 autoplay:false,easing:1,interpolation:0,noshadow:false,autorotate:0,visibility:7,displaySlots:{}};
const quad=(last,face='1 2 3 4')=>`v 0 0 0\nv 1 0 0\nv 1 1 0\nv ${last}\nvt 0 0\nusemtl m_u\nf ${face.split(' ').map(i=>i+'/1').join(' ')}`;

it('uses one first-triangle normal for both halves of a warped flat quad in the item and profile paths',async()=>{
 const {api}=loadColorPlugin(), obj=quad('0 1 0.35');
 const out=await api.buildOutput(cfg,[obj],'');
 const px=i=>out.rawBuf.subarray(i*4,i*4+4);
 expect(px(out.tw)[2]&8).toBe(8);
 const uRow=2+Math.ceil(out.nfaces/out.tw)+px(1)[2]*256+px(7)[0]+px(5)[0]*256+px(5)[1];
 const vRow=uRow+px(5)[2]*256+px(7)[2];
 for(let c=0;c<4;c++){
  const [r,g,b]=px(vRow*out.tw+2*c+1), u=uRow*out.tw+2*(r*65536+g*256+b);
  expect([px(u)[0],px(u+1)[0]]).toEqual([128,127]); // +Z for all four corners
 }
 const native=api.nativeSkinData({...cfg,skinEnabled:true,shadingMode:'flat'},[obj],new Set(['m_u']),[0],1);
 expect(native.vertices.map(v=>native.normals[v[2]])).toEqual(Array(4).fill([0,0,1]));
});

it('retains geometric flat lighting for planar quads, harmless numerical noise, and folded or missing corners',async()=>{
 const {api}=loadColorPlugin();
 for(const obj of [quad('0 1 0'),quad('0 1 0.000001'),quad('2 0 0'),quad('0 1 0','1 2 2 4'),quad('0 1 0','1 2 3 5')]){
  expect(api.parseObj(obj,0,'flat').cornerNormals?.[0] ?? null).toBeNull();
 }
});
