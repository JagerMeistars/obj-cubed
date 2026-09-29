// CPU-only execution of Blockbench's project parser, hierarchy loader, native
// preview matrices, cube vertex method and OBJ codec. No app/profile/UI access.
// Official sources and the independent Minecraft probe are audit inputs rather
// than shipped dependencies. See --source / --three / --probe overrides below.
// Usage: node tools/validate-equipment-templates.mjs --source <Blockbench source>
//   --three <three.module.mjs> --probe <native-models.json> --output <directory>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
const require=createRequire(import.meta.url);
const {decodeArmorHeader,decodeModelFaceOffsets}=require('../test/helpers/armor-ref-decode.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:path.resolve(process.argv[i+1]);};
const source=arg('--source',path.join(root,'audit/2026-09-28/blockbench-5.2.1-source'));
const threeFile=arg('--three',path.join(root,'audit/2026-09-28/installed-three.module.mjs'));
const probeFile=arg('--probe',path.join(root,'audit/template-native/native-models.json'));
const output=arg('--output',path.join(root,'audit/template-native/template-proof'));
const THREE=await import(pathToFileURL(threeFile));
const read=p=>fs.readFileSync(p,'utf8'), json=p=>JSON.parse(read(p));
const official=p=>read(path.join(source,p));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const methods={
  project:official('js/formats/bbmodel.js'),outliner:official('js/outliner/outliner.js'),
  cube:official('js/outliner/types/cube.js'),obj:official('js/formats/standards/obj.js'),
};
function extract(text,name,start=0){
  const begin=text.indexOf(name+'(',start);assert(begin>=0,`Native method ${name} missing`);
  const body=text.indexOf('{',begin);let end=body+1,depth=1;
  for(;depth&&end<text.length;end++){if(text[end]==='{')depth++;else if(text[end]==='}')depth--;}
  assert.equal(depth,0);return text.slice(begin,end);
}
const native={parse:extract(methods.project,'parse',methods.project.indexOf('\tparse(model')),
  load:extract(methods.outliner,'loadJSON'),transform:extract(methods.outliner,'updateTransform',methods.outliner.indexOf('\tupdateTransform(element)')),
  vertices:extract(methods.cube,'getGlobalVertexPositions'),adjust:extract(methods.cube,'adjustFromAndToForInflateAndStretch',methods.cube.indexOf('export function adjustFrom')),
  faceIndices:extract(methods.cube,'getVertexIndices')};
for(const [name,fn] of Object.entries({empty(){this.length=0;return this;},V3_subtract(v){for(let i=0;i<3;i++)this[i]-=v[i];return this;}}))
  if(!Array.prototype[name])Object.defineProperty(Array.prototype,name,{value:fn,configurable:true});
const carriers=json(path.join(root,'tools/equipment-carriers.json'));
const fixture=json(path.join(root,'tools/equipment-template-models.json'));
const probe=json(probeFile);
const stats={mode:'CPU only: real Blockbench 5.2.1 parser/hierarchy/transform/OBJ code with data containers mocked; no UI or game render',
  threeRevision:THREE.REVISION,sourceHashes:Object.fromEntries(Object.entries(native).map(([k,v])=>[k,hash(v)])),
  conditionalHiddenStates:0,conditionalVisibleStates:0,targets:0,previewElements:0,previewMeshes:0,previewCornerUVChecks:0,exportedCubes:0,excludedGuideElements:0,poseVertices:0,maxPositionError:0,maxPackedPositionErrorBlocks:0,maxUVError:0,models:[]};
stats.sourceHashes.OBJCodec=hash(methods.obj);
stats.sourceHashes.nativeProbe=hash(read(probeFile));
stats.sourceHashes.plugin=hash(read(path.join(root,'objcubed.js')));
const epsilon=0.0001;
function near(a,b,why,tolerance=epsilon){const error=Math.abs(a-b);assert(error<=tolerance,`${why}: ${a} != ${b} (error ${error})`);return error;}
function bbPoint(native){return[native[0]*16,24-native[1]*16,native[2]*16];}
function createRuntime(doc){
  const scene=new THREE.Scene(),model=new THREE.Object3D();scene.add(model);
  const uuids={},elements=[],groups=[],textures=[];
  class Node{
    constructor(data,id){Object.assign(this,structuredClone(data));this.uuid=id||data.uuid;this.parent='root';this.children=[];uuids[this.uuid]=this;
      this.mesh=new THREE.Object3D();this.mesh.name=this.uuid;this.mesh.rotation.order='ZYX';}
    removeFromParent(){const list=this.parent==='root'?Outliner.root:this.parent.children;const i=list.indexOf(this);if(i>=0)list.splice(i,1);return this;}
    init(){(this instanceof Group?groups:elements).push(this);Outliner.root.push(this);return this;}
    getTypeBehavior(name){return ['movable','rotatable','use_absolute_position'].includes(name)||(name==='parent'&&this instanceof Group);}
  }
  class Group extends Node{}
  Group.all=groups;
  class Cube extends Node{
    constructor(data){super(data);this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());this.mesh.name=this.uuid;this.mesh.rotation.order='ZYX';
      this.inflate??=0;this.stretch??=[1,1,1];this.rotation??=[0,0,0];
      for(const [direction,face]of Object.entries(this.faces)){face.direction=direction;face.getTexture=()=>textures.find(t=>t.uuid===face.texture);face.getVertexIndices=nativeFaceIndices;}}
    size(){return this.to.map((v,i)=>v-this.from[i]);}
  }
  Cube.all=elements;
  class Mesh extends Node{
    constructor(data){super(data);this.mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial());this.mesh.name=this.uuid;this.mesh.rotation.order='ZYX';
      for(const face of Object.values(this.faces))face.getTexture=()=>textures.find(t=>t.uuid===face.texture);}
  }
  class Texture{constructor(data,id){Object.assign(this,data);this.uuid=id;}add(){textures.push(this);return this;}fromDataURL(url){assert.match(url,/^data:image\/png;base64,/);return this;}static getDefault(){return textures[0];}}
  Texture.all=textures;
  const Project={model_3d:model,name:doc.name,export_options:{},getUVWidth(t){return t?.uv_width||doc.resolution.width;},getUVHeight(t){return t?.uv_height||doc.resolution.height;}};
  const Format={bone_rig:true,optional_box_uv:true,euler_order:'ZYX',select(){}};
  const Outliner={root:[],elements,ROOT:'root'};
  const ctx={Array,THREE,scene,Project,Format,Outliner,OutlinerNode:Node,OutlinerElement:{fromSave(data){assert(['cube','mesh'].includes(data.type));return data.type==='cube'?new Cube(data):new Mesh(data);}},
    Group,Cube,Mesh,Texture,console,isApp:false,ModelProject:{properties:{}},Formats:{free:Format},
    Math:Object.assign(Object.create(Math),{degToRad:x=>x*Math.PI/180}),
    processHeader(){assert.equal(doc.meta.format_version,'5.0');},processCompatibility(){},
    Blockbench:{dispatchEvent(){}},ArmatureBone:{all:[]},ReferenceImage:{updateAll(){}},Validator:{validate(){}},
    Interface:{Panels:{variable_placeholders:{inside_vue:{_data:{}}}}},
    Canvas:{updateAllBones(){for(const group of groups)transform.call(controller,group);},updateAllPositions(){for(const element of elements)transform.call(controller,element);scene.updateMatrixWorld(true);},updateAllFaces(){}},
    Settings:{get(name){return name==='model_export_scale'?16:'quads';}},appVersion:'5.2.1',BARS:{defineActions(){}},
    Codec:class{constructor(id,definition){Object.assign(this,definition);ctx.objCodec=this;}dispatchEvent(){}}};
  Node.uuids=uuids;
  const controller={dispatchEvent(){}};
  vm.createContext(ctx);
  vm.runInContext('Object.defineProperty([].constructor.prototype,"V3_subtract",{value:function(v){for(let i=0;i<3;i++)this[i]-=v[i];return this;}})',ctx);
  const method=text=>vm.runInContext(`({${text}})`,ctx);
  const nativeFaceIndices=method(native.faceIndices).getVertexIndices;
  ctx.adjustFromAndToForInflateAndStretch=method(native.adjust).adjustFromAndToForInflateAndStretch;
  Cube.prototype.getGlobalVertexPositions=method(native.vertices).getGlobalVertexPositions;
  const transform=method(native.transform).updateTransform;
  Outliner.loadJSON=method(native.load).loadJSON;
  method(native.parse).parse.call({dispatchEvent(){}},doc);
  vm.runInContext(methods.obj,ctx,{filename:'official-Blockbench-5.2.1-obj.js'});
  return{groups,elements,textures,Project,Outliner,Group,Cube,Mesh,scene,codec:ctx.objCodec,Texture};
}
function facePairs(cube,face){
  if(cube.type==='mesh')return face.vertices.map(key=>[...new THREE.Vector3(...cube.vertices[key]).applyMatrix4(cube.mesh.matrixWorld).toArray(),...face.uv[key]]);
  const vertices=cube.getGlobalVertexPositions(),uv=[[face.uv[0],face.uv[1]],[face.uv[2],face.uv[1]],[face.uv[2],face.uv[3]],[face.uv[0],face.uv[3]]];
  for(let rotation=face.rotation||0;rotation>0;rotation-=90)uv.unshift(uv.pop());
  return face.getVertexIndices().map((v,i)=>[...vertices[v],...uv[i]]);
}
const previews=[];
function loadExporter(runtime){
  class Image{set src(s){this.png=PNG.sync.read(Buffer.from(s.split(',')[1],'base64'));queueMicrotask(()=>this.onload());}get naturalWidth(){return this.png.width;}get naturalHeight(){return this.png.height;}}
  const module={exports:{}};
  const ctx={...runtime,Image,Buffer,require,module,exports:module.exports,settings:{language:{value:'en'}},setTimeout,clearTimeout,
    console:{log(){},warn(){},error:console.error},Texture:runtime.Texture,BBPlugin:{register(){}},Plugin:{register(){}},
    Codecs:{obj:runtime.codec},document:{createElement(){let image;return{getContext(){return{drawImage(img){image=img;},getImageData(){return image.png;}};}};}}};
  ctx.globalThis=ctx;
  const plugin=read(path.join(root,'objcubed.js')).replace('module.exports.__test = {','module.exports.__test = { getObjContents,');
  vm.runInNewContext(plugin,ctx,{filename:'objcubed.js'});return module.exports.__test;
}
const vector=p=>new THREE.Vector3(...p),sub=(a,b)=>vector(a).sub(vector(b));
function frameMatrix(a,b,c){return new THREE.Matrix3().set(a.x,b.x,c.x,a.y,b.y,c.y,a.z,b.z,c.z);}
function reconstruct(png,slot,face,source){
  const row=png.data[56]*256+png.data[57],base=row*png.width*4;
  const values=Array.from({length:99},(_,i)=>png.data.readFloatLE(base+i*4)),d=values.slice(slot*16,slot*16+16);
  const q0=d.slice(4,7),q1=d.slice(7,10),q3=d.slice(10,13),n=d.slice(13,16),pivot=values.slice(96,99);
  const verts=face.verticesModelBlocksUVNormalized,min=[Math.min(...verts.map(p=>p[3])),Math.min(...verts.map(p=>p[4]))],max=[Math.max(...verts.map(p=>p[3])),Math.max(...verts.map(p=>p[4]))];
  const ordered=[];for(const v of verts){const right=v[3]>(min[0]+max[0])/2,top=v[4]<(min[1]+max[1])/2;ordered[top?(right?0:1):(right?3:2)]=v.slice(0,3);}
  const lu=sub(q0,q1),lv=sub(q0,q3),au=sub(ordered[0],ordered[1]),av=sub(ordered[0],ordered[3]);
  const actualNormal=au.clone().cross(av).normalize();if(actualNormal.dot(vector(face.normalModel))<0)actualNormal.negate();
  const scale=(au.length()/lu.length()+av.length()/lv.length())/2;
  const local=frameMatrix(lu.clone().normalize(),lv.clone().normalize(),vector(n).normalize());
  const basis=frameMatrix(au.clone().divideScalar(lu.length()),av.clone().divideScalar(lv.length()),actualNormal.multiplyScalar(scale)).multiply(local.invert());
  const origin=vector(ordered[0]).sub(vector(q0).applyMatrix3(basis));
  return vector([source[0],-(source[1]+.5),source[2]]).sub(vector(pivot)).applyMatrix3(basis).add(origin).toArray();
}
for(const [target,nativeModel]of Object.entries(fixture.models)){
  const doc=json(path.join(root,'templates/animal-equipment',target+'.bbmodel'));
  const runtime=createRuntime(doc),bindingMap=new Map(Object.entries(nativeModel.partBindings||Object.fromEntries(Object.entries(carriers.targets?.[target]?.bindings||carriers[target].bindings).map(([role,b])=>[b.path,role]))));
  assert(doc.objcubed.equipmentRestTransforms,`${target}: missing fixed rest transform metadata`);
  const nativeProbe=probe.models.find(m=>m.modelLayerConstant===nativeModel.modelLayer);assert(nativeProbe,target+' probe');
  const rest=nativeProbe.states.find(s=>s.name==='rest');assert(rest);
  const targetStats={target,cubes:0,exported:0,guides:0,poses:[]};
  const quads=[];
  const conditionalStates=new Set();
  for(const cube of runtime.elements){
    const record=doc.objcubed.template.nativeCubeMap[cube.uuid];
    const partPath=record?.path||cube.objcubed_native_path||cube.parent.objcubed_native_path;
    const cubeIndex=record?.index??record?.cubeIndex??cube.objcubed_native_cube_index;
    assert(partPath&&Number.isInteger(cubeIndex),`${target}/${cube.name}: native provenance missing`);
    const part=rest.parts.find(p=>p.path===partPath),nativeCube=part?.cubes[cubeIndex];assert(nativeCube,`${target}/${partPath}/${cubeIndex}`);
    const descriptor=carriers[target].bindings[bindingMap.get(partPath)];
    const conditional=descriptor?.visibleWhen==='ridden';
    const expectedPairs=nativeCube.faces.filter(f=>!bindingMap.has(partPath)||f.uvRectPixels[2]>f.uvRectPixels[0]&&f.uvRectPixels[3]>f.uvRectPixels[1]).flatMap(f=>f.verticesModelBlocksUVNormalized);
    const expected=expectedPairs.map(v=>[...bbPoint(v),v[3]*nativeModel.textureSize[0],v[4]*nativeModel.textureSize[1]]);
    const got=Object.values(cube.faces).filter(f=>f.texture!==null).flatMap(f=>facePairs(cube,f));
    assert.equal(got.length,expected.length,`${target}/${partPath} corner count`);
    for(const actual of got){
      const nearest=expected.reduce((best,p)=>{const d=p.reduce((sum,v,i)=>sum+(v-actual[i])**2,0);return d<best.d?{p,d}:best;},{p:null,d:Infinity}).p;
      for(let i=0;i<5;i++){const error=near(actual[i],nearest[i],`${target}/${partPath} corner+UV ${i}`);if(i<3)stats.maxPositionError=Math.max(stats.maxPositionError,error);else stats.maxUVError=Math.max(stats.maxUVError,error);}
      stats.previewCornerUVChecks++;
    }
    const expectedExport=bindingMap.has(partPath)&&(part.effectivelyVisible||conditional)&&!part.skipDraw;
    assert.equal(cube.export!==false,expectedExport,`${target}/${partPath} export status`);
    assert.equal(cube.visibility!==false,(part.effectivelyVisible||conditional)&&!part.skipDraw,`${target}/${partPath} rest visibility`);
    if(expectedExport)assert.equal(cube.parent.objcubed_equipment_part,bindingMap.get(partPath),`${target}/${partPath} rigid ancestor assignment`);
    if(expectedExport){targetStats.exported++;stats.exportedCubes++;}else{targetStats.guides++;stats.excludedGuideElements++;}
    targetStats.cubes++;stats.previewElements++;if(cube.type==='mesh')stats.previewMeshes++;
    if(cube.visibility!==false)for(const face of Object.values(cube.faces))if(face.texture!==null)quads.push({points:facePairs(cube,face).map(p=>p.slice(0,3)),guide:!expectedExport,color:cube.color??0});
  }
  const obj=runtime.codec.compile({});
  assert.equal(obj.split('\n').filter(l=>l.startsWith('o ')).length,targetStats.exported,`${target} actual OBJ guide exclusion`);
  const api=loadExporter(runtime),cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],
    duration:0,autoplay:false,easing:0,interpolation:0,noshadow:false,autorotate:3,visibility:7,displaySlots:{},flipuv:false,
    useAtlas:false,texAnimEnabled:false,exportAsEquipment:true,equipmentTarget:target,selectedPieces:[]};
  const {objs,mtl}=await api.getObjContents(cfg),built=await api.buildOutput(cfg,objs,mtl),layers=api.planAnimalLayers(built,cfg);
  for(const state of nativeProbe.states.filter(s=>['rest','moving','action1','action2'].includes(s.name))){
    let count=0;
    for(const layer of layers){
      const png=PNG.sync.read(api.encodeAnimalLayer(built,cfg,layer,built.faceEmission)),header=decodeArmorHeader(png);
      const carrier=(carriers.targets?.[target]||carriers[target]).bindings[layer.part];
      const carrierPart=state.parts.find(p=>p.path===carrier.path),carrierCube=carrierPart.cubes[carrier.cubeIndex];
      if(carrier.visibleWhen==='ridden'||/^(left|right)_ear$/.test(layer.part)) {
        if(carrier.visibleWhen==='ridden')assert.equal(carrierPart.effectivelyVisible,!!state.assignedState.isRidden, target+' native rider visibility');
        for(const q of carrier.quads) {
          const overlaps=[];
          for(const p of state.parts)if(p.effectivelyVisible&&!p.skipDraw)
            for(const [index,cube]of p.cubes.entries())for(const face of cube.faces) {
              const r=face.uvRectPixels.map((v,i)=>v/nativeModel.textureSize[i%2]);
              if(Math.min(r[2],q.uv[2])-Math.max(r[0],q.uv[0])>1e-7&&Math.min(r[3],q.uv[3])-Math.max(r[1],q.uv[1])>1e-7)
                overlaps.push({path:p.path,index});
            }
          assert.deepEqual(overlaps,carrierPart.effectivelyVisible?[{path:carrier.path,index:carrier.cubeIndex}]:[],target+'/'+state.name+' exclusive carrier UV');
        }
        if(carrier.visibleWhen==='ridden'&&!conditionalStates.has(state.name)) {
          stats[carrierPart.effectivelyVisible?'conditionalVisibleStates':'conditionalHiddenStates']++;
          conditionalStates.add(state.name);
        }
      }
      if(!carrierPart.effectivelyVisible||carrierPart.skipDraw)continue;
      for(let slot=0;slot<layer.faces.length;slot++){
        const faceIndex=layer.faces[slot],elementIndex=Number(/^ocp\d+e\d+i(\d+)$/.exec(built.faceGroups[faceIndex])[1]);
        const element=runtime.elements[elementIndex],rec=doc.objcubed.template.nativeCubeMap[element.uuid];
        const nativePath=rec?.path||element.objcubed_native_path||element.parent.objcubed_native_path,index=rec?.index??rec?.cubeIndex??element.objcubed_native_cube_index;
        const expectedCube=state.parts.find(p=>p.path===nativePath).cubes[index];
        const expected=expectedCube.faces.flatMap(f=>f.verticesModelBlocksUVNormalized.map(v=>v.slice(0,3)));
        const rect=carrier.quads[slot].uv,face=carrierCube.faces.find(f=>{
          const p=f.verticesModelBlocksUVNormalized,r=[Math.min(...p.map(v=>v[3])),Math.min(...p.map(v=>v[4])),Math.max(...p.map(v=>v[3])),Math.max(...p.map(v=>v[4]))];
          return r.every((v,i)=>Math.abs(v-rect[i])<1e-5);});assert(face,`${target}/${layer.part} carrier UV face ${slot}`);
        for(const source of decodeModelFaceOffsets(header,faceIndex,false)){
          const actual=reconstruct(png,slot,face,source),nearest=expected.reduce((best,p)=>{const d=p.reduce((sum,v,i)=>sum+(v-actual[i])**2,0);return d<best.d?{p,d}:best;},{p:null,d:Infinity}).p;
          for(let i=0;i<3;i++){const error=near(actual[i],nearest[i],`${target}/${nativePath} ${state.name} packed reconstruction ${i}`,0.00005);stats.maxPackedPositionErrorBlocks=Math.max(stats.maxPackedPositionErrorBlocks,error);}
          count++;stats.poseVertices++;
        }
      }
    }
    targetStats.poses.push({name:state.name,vertices:count});
  }
  previews.push({target,quads});stats.targets++;stats.models.push(targetStats);
}
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'preview-geometry.json'),JSON.stringify(previews));
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(stats,null,2)+'\n');
console.log(JSON.stringify(stats,null,2));
