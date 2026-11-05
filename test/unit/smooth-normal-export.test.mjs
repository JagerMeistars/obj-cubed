import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadColorPlugin}=require('../helpers/color-plugin.cjs');
const {PNG}=require('pngjs');

const geometry='v 0 0 0\nv 1 0 0\nv 0 1 0\nvt .5 .5\nusemtl m_u\n';
const axes='vn 0 0 1\nvn 1 0 0\nvn 0 1 0\n';
const triangle=(refs=[1,2,3])=>'f '+refs.map((n,i)=>(i+1)+'/1'+(n==null?'':'/'+n)).join(' ');
const cfg={texIndex:0,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:0,
  autoplay:true,easing:1,interpolation:0,noshadow:false,autorotate:3,visibility:7,displaySlots:{}};

async function exported(frames, skin=false, shadingMode) {
  const {api,context}=loadColorPlugin();
  if(skin) Object.assign(context.Texture.all[0],{width:64,height:64});
  const out=await api.buildOutput({...cfg,skinEnabled:skin,skinSlot:0,shadingMode},frames,'');
  const png=PNG.sync.read(out.pngBuffer), w=png.width;
  const at=(index)=>png.data.subarray(index*4,index*4+4);
  const uvStart=(2+Math.ceil(out.nfaces/w)+at(1)[2]*256+at(7)[0]+at(5)[0]*256+at(5)[1])*w;
  const refsStart=uvStart+(at(5)[2]*256+at(7)[2])*w;
  const normal=(corner)=>{
    const ref=at(refsStart+corner*2+1), uv=(ref[0]*65536+ref[1]*256+ref[2])*2;
    return [at(uvStart+uv)[0],at(uvStart+uv+1)[0]];
  };
  return {png:png.data, normal,closed:!!(at(w)[2]&4),smooth:!!(at(w)[2]&8),markerAlpha:at(w)[3]};
}

describe('Blockbench smooth normals in the geometry payload',()=>{
  it('smooths shared OBJ positions across a UV seam on each animation pose, without welding distinct parts',async()=>{
    const pose=z=>`o piece\n${geometry}vt .25 .25\nv 0 0 ${z}\nf 1/1 2/1 3/1\nf 1/2 3/2 4/2\nf 1/2 1/2 3/2\no piece\nf 1/1 4/1 2/1`;
    const result=await exported([pose(1),pose(-1)],false,'smooth');
    expect(result.smooth).toBe(true);
    expect([0,4,16,20].map(result.normal)).toEqual([[192,127],[192,127],[66,127],[66,127]]);
    expect(result.normal(1)).toEqual([128,127]); // non-shared corner still points along Z
    expect(result.normal(8)).toEqual([0,0]); // degenerate triangle stays flat
    expect(result.normal(12)).toEqual([128,254]); // independent object, despite reusing the same position indices
  });
  it.each([undefined,'model','flat','invalid'])('ignores authored normals unless smoothing is explicitly enabled (%s)',async mode=>{
    const flat=await exported([geometry+triangle([null,null,null])]);
    const forced=await exported([geometry+axes+triangle()],false,mode);
    expect(forced.png).toEqual(flat.png);
  });
  it('does not give a folded-back zero-area quad a normal or alter adjoining geometry',async()=>{
    const src=geometry+'f 1/1 2/1 3/1\nf 1/1 2/1 1/1 3/1';
    const result=await exported([src],false,'smooth');
    expect(result.normal(0)).toEqual([128,127]);
    expect(result.normal(4)).toEqual([0,0]);
  });
  it('preserves different generated normals at the same UV and pads the last triangle corner',async()=>{
    const result=await exported([geometry+'v 0 0 1\n'+triangle()+'\nf 1/1 3/1 4/1'],false,'smooth');
    expect(result.smooth).toBe(true);
    expect(result.markerAlpha).toBe(255);
    expect([0,1,2,3,4,5,6,7].map(result.normal)).toEqual([
      [192,127],[128,127],[192,127],[192,127], [192,127],[192,127],[254,127],[254,127],
    ]);
  });
  it('keeps the skin material bit independent of a smooth normal',async()=>{
    const result=await exported([geometry+axes+triangle()+'\nf 1/1 1/1 2/1'],true,'smooth');
    expect(result.normal(0)).toEqual([129,127]);
    expect(result.normal(4)).toEqual([1,0]);
  });
  it('encodes flat, absent and partially invalid normals exactly like the old flat model',async()=>{
    const old=(await exported([geometry+triangle([null,null,null])])).png;
    for(const refs of [[1,1,1],[1,null,3],[1,2,99]]) {
      expect((await exported([geometry+axes+triangle(refs)])).png).toEqual(old);
    }
  });
  it('keeps a terminal frame with distinct normals even if positions quantize to the same bytes',async()=>{
    const a=geometry.replace('v 1 0 0','v .000012 0 0').replace('v 0 1 0','v 0 .000012 0')+triangle();
    const b=a.replace('v 0 .000012 0','v 0 .000012 .000012');
    const result=await exported([a,b],false,'smooth');
    expect(result.closed).toBe(false);
    expect(result.normal(4)).toEqual([128,64]);
    expect((await exported([a,b,a],false,'smooth')).closed).toBe(true);
  });
  it('carries the current baked pose normals through the fixed face topology',async()=>{
    const {api,context}=loadColorPlugin();
    const timeline={time:7};
    class Mesh {} Mesh.all=[];
    Object.assign(context,{Mesh,Timeline:timeline,Animator:{preview(){}},setTimeout,
      Cube:class{},Group:class{},Codecs:{obj:{compile(){return {obj:(timeline.time===0?geometry:
        geometry.replace('v 0 1 0','v 0 0 1'))+axes+triangle()};}}}});
    const {objs}=await api.compileAnimatedObjFrames({select(){},length:1,snapping:1},{fps:1});
    expect((await exported(objs,false,'smooth')).normal(4)).toEqual([128,0]);
    expect(timeline.time).toBe(7);
  });
  it('generates normals from the mesh remaining after armature bone geometry is removed',async()=>{
    const {api,context}=loadColorPlugin();
    const src='o bone\nv 0 0 0\nvt 0 0\nvn 0 -1 0\no mesh\n'+geometry+axes+
      'f 2/2/2 3/2/3 4/2/4';
    class Mesh {} Mesh.all=[];
    Object.assign(context,{Mesh,Timeline:{time:0},Animator:{preview(){}},setTimeout,
      Cube:class{},Group:class{},Outliner:{root:[{uuid:'bone',type:'armature_bone'}]},
      Codecs:{obj:{compile:()=>({obj:src})}}});
    const {objs}=await api.compileAnimatedObjFrames({select(){},length:0,snapping:1},{fps:1});
    const result=await exported(objs,false,'smooth');
    expect([0,1,2].map(result.normal)).toEqual([[128,127],[128,127],[128,127]]);
  });
});
