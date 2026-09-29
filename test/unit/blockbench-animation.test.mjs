import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {loadObjcubedWithContext} = require('../helpers/load-plugin.cjs');

// The fixture isolates Blockbench's animation API contract; all transforms are
// translations. It catches mesh ownership and state restoration, not 3D math.
class Matrix4 {
  constructor(){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
  copy(m){this.elements=[...m.elements];return this;}
  invert(){for(const i of [12,13,14])this.elements[i]*=-1;return this;}
  makeRotationFromEuler(){return this;}
  setPosition(x,y,z){this.elements.splice(12,3,x,y,z);return this;}
  multiplyMatrices(a,b){this.copy(a);for(const i of [12,13,14])this.elements[i]+=b.elements[i];return this;}
}
const vector = () => ({clone(){return vector();},copy(){return this;}});
const object3d = () => ({matrixWorld:new Matrix4(),position:vector(),quaternion:vector(),scale:vector(),updateWorldMatrix(){},updateMatrixWorld(){}});
function fixture({failCompile=false}={}) {
  const timeline={time:7};
  const bone={uuid:'bone',name:'joint',type:'armature_bone',origin:[0,0,0],rotation:[0,0,0],
    mesh:object3d(),vertex_weights:{'aaaaaa:v0':1}};
  const mesh=(uuid) => ({uuid,name:uuid,type:'mesh',visibility:true,
    vertices:{v0:[0,0,0]},mesh:object3d(),getArmature(){return armature;}});
  const a=mesh('aaaaaa-0000'),b=mesh('bbbbbb-0000');
  const calls=[],previews=[];
  const armature={uuid:'rig',type:'armature',visibility:true,children:[bone,a,b],
    getAllBones(){return [bone];},calculateVertexDeformation(mesh){calls.push(mesh.uuid);return {v0:[mesh===a ? timeline.time : 0,0,0]};}};
  for(const el of [bone,a,b])el.parent=armature;
  bone.mesh.parent=object3d();
  const animation={length:1,snapping:1,select(){}};
  class Group {}
  const {api}=loadObjcubedWithContext({globals:{setTimeout,Group,
    console:{log(){},warn(){},error(){}},THREE:{Matrix4,Euler:class{}},
    Timeline:timeline,Animator:{preview(){previews.push({time:timeline.time,a:[...a.vertices.v0],b:[...b.vertices.v0]});bone.mesh.matrixWorld.setPosition(timeline.time,0,0);}},
    Mesh:{all:[a,b]},Armature:{all:[armature]},Outliner:{root:[armature]},
    Codecs:{obj:{compile(){if(failCompile)throw new Error('codec failed');return {obj:[a,b].map(m=>`o ${m.uuid}\nv ${m.vertices.v0.join(' ')}`).join('\n'),mtl:''};}}},
  }});
  return {api,a,b,calls,previews,timeline,animation,armature};
}
describe('Blockbench armature animation contract',()=>{
  it('keeps unweighted meshes still when another mesh has the same vertex keys',async()=>{
    const f=fixture();
    const output=await f.api.compileAnimatedObjFrames(f.animation,{fps:1,frameStart:0,frameEnd:1});
    expect(output.objs[1]).toContain('o aaaaaa-0000\nv 1 0 0');
    expect(output.objs[1]).toContain('o bbbbbb-0000\nv 0 0 0');
    expect(f.a.vertices.v0).toEqual([0,0,0]);
    expect(f.b.vertices.v0).toEqual([0,0,0]);
    expect(f.timeline.time).toBe(7);
  });
  it('uses the editor deformation API so its current rig evaluation is authoritative',async()=>{
    const f=fixture();
    f.armature.calculateVertexDeformation=mesh=>({v0:[mesh===f.a?3*f.timeline.time:0,0,0]});
    const output=await f.api.compileAnimatedObjFrames(f.animation,{fps:1,frameStart:0,frameEnd:1});
    expect(output.objs[1]).toContain('o aaaaaa-0000\nv 3 0 0');
  });
  it('restores original vertices, timeline and outliner when the OBJ codec fails',async()=>{
    const f=fixture({failCompile:true});
    await expect(f.api.compileAnimatedObjFrames(f.animation,{fps:1,frameStart:1,frameEnd:1})).rejects.toThrow('codec failed');
    expect(f.a.vertices.v0).toEqual([0,0,0]);
    expect(f.b.vertices.v0).toEqual([0,0,0]);
    expect(f.timeline.time).toBe(7);
    expect(f.armature.children.map(e=>e.uuid)).toEqual(['bone','aaaaaa-0000','bbbbbb-0000']);
    expect(f.previews.at(-1)).toEqual({time:7,a:[0,0,0],b:[0,0,0]});
  });
  it('keeps mesh-scoped weights isolated in the legacy fallback too',async()=>{
    const f=fixture();
    delete f.armature.calculateVertexDeformation;
    const output=await f.api.compileAnimatedObjFrames(f.animation,{fps:1,frameStart:0,frameEnd:1});
    expect(output.objs[1]).toContain('o aaaaaa-0000\nv 1 0 0');
    expect(output.objs[1]).toContain('o bbbbbb-0000\nv 0 0 0');
  });
});
