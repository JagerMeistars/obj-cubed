// Generic equipment: real native posed models versus source OBJ geometry.
// Shared bindings use a full-cube, axis-wise correspondence between the native
// bind meshes; the oracle does not reconstruct a pose from a single quad.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
import {floats,uv} from './horse-fixture-library.mjs';
const require=createRequire(import.meta.url),{loadPlugin}=require('../../test/helpers/load-plugin.cjs'),{makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/2026-09-29/equipment-expansion/v2-gpu');fs.mkdirSync(out,{recursive:true});
const nativePath=path.resolve(process.argv[3]??'audit/2026-09-29/equipment-expansion/native-models.json');
const vanillaRoot=path.resolve(process.argv[4]??'audit/2026-09-28/vanilla');
const catalog=JSON.parse(fs.readFileSync('tools/equipment-carriers.json','utf8')),native=JSON.parse(fs.readFileSync(nativePath,'utf8')).models;
const source=path.resolve('objcubed'),sourceHashes={};for(const[ext,stage]of[['vsh','vert'],['fsh','frag']]){let text=expandShader(path.join(source,'assets/minecraft/shaders/core/entity.'+ext),[source,vanillaRoot]).replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');fs.writeFileSync(path.join(out,'entity.'+stage),text);sourceHashes[ext]=crypto.createHash('sha256').update(text).digest('hex');}
const image={width:32,height:32,data:Buffer.alloc(32*32*4)};for(let y=0;y<32;y++)for(let x=0;x<32;x++)image.data.set([x<16?225:175,y<16?65:155,95,255],(y*32+x)*4);const sourceTexture=path.join(out,'source.rgba');fs.writeFileSync(sourceTexture,image.data);
function panels(){return Array.from({length:6},(_,f)=>{const x=f%3*.42-.6,y=Math.floor(f/3)*.4-.2;return[[x,y,0],[x+.35,y,0],[x+.35,y+.33,0],[x,y+.33,0]];});}
const sourceQuads=panels();
function obj(quads){const rows=[];for(let f=0;f<quads.length;f++){rows.push(`o ocp1e0i${f}`);for(const p of quads[f])rows.push('v '+p.join(' '));for(const p of uv)rows.push('vt '+p.join(' '));rows.push('f '+[0,1,2,3].map(k=>`${f*4+k+1}/${f*4+k+1}`).join(' '));}return rows.join('\n');}
async function exported(target,binding){const memory=makeMemFs();class Image{set src(s){queueMicrotask(()=>this.onload?.());}get naturalWidth(){return 32;}get naturalHeight(){return 32;}}
 const api=loadPlugin(path.resolve('objcubed.js'),{requireImpl:id=>id==='fs'?memory:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,console:{log(){},warn(){},error:console.error},document:{createElement(){return{getContext(){return{drawImage(){},getImageData(){return image;}};}};}},Texture:{all:[{uuid:'t0',name:'pattern',source:'data:0',img:{src:'data:0'},uv_height:32,uv_width:32,frameCount:1}]},Outliner:{root:[]},Blockbench:{export(){throw Error('Unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:'v2',export_path:''},BarItems:{}}});
 const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],duration:4,autoplay:false,easing:0,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots:{},flipuv:false,useAtlas:false,texAnimEnabled:false,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:`v2_${target}_${binding}`,exportAsEquipment:true,equipmentTarget:target,selectedPieces:[]};
 const result=await api.buildOutput(cfg,[obj(sourceQuads.slice(0,catalog[target].bindings[binding].quads.length))],'');result.faceToEquipmentBinding=Array.from({length:result.nfaces},()=>({part:binding,pivot:[0,0,0],key:'fixture'}));await api.saveSingleOutput(result,api.buildDisplayTransforms(cfg),cfg);
 const layers=[...memory.writes].filter(([file])=>file.includes(`/textures/entity/equipment/${target}/`)&&file.endsWith('.png')).map(([filename,data])=>({filename,png:Buffer.from(data),...PNG.sync.read(Buffer.from(data))}));if(layers.length!==1)throw Error(`${target}/${binding}: expected1layer, got${layers.length}`);if(layers[0].data[8*4+3]!==2)throw Error('Missing v2 descriptor');return layers[0];
}
const transform=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},rect=(face,size)=>face.uvRectPixels.map((x,i)=>x/size[i%2]),same=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<1e-6);
function matchingCubes(model,binding){const baked=model.states.find(s=>s.name==='baked'),result=[];for(const part of baked.parts)for(let cube=0;cube<part.cubes.length;cube++){const faces=part.cubes[cube].faces;if(binding.quads.every(q=>faces.some(f=>same(rect(f,model.textureSize),q.uv))))result.push({path:part.path,cube});}return result;}
function cubeMap(reference,refSize,target,targetSize){const pairs=[];for(const face of reference.faces.filter(f=>f.uvRectPixels[2]>f.uvRectPixels[0]&&f.uvRectPixels[3]>f.uvRectPixels[1])){const other=target.faces.find(f=>same(rect(f,targetSize),rect(face,refSize)));if(!other)throw Error('Missing cube face');for(const a of face.verticesLocalPixelsUVPixels){const uv0=[a[3]/refSize[0],a[4]/refSize[1]],b=other.verticesLocalPixelsUVPixels.find(b=>same([b[3]/targetSize[0],b[4]/targetSize[1]],uv0));if(!b)throw Error('Missing cube vertex');pairs.push([a.slice(0,3).map(x=>x/16),b.slice(0,3).map(x=>x/16)]);}}
 const scale=[],offset=[];for(let k=0;k<3;k++){const sx=pairs.reduce((s,p)=>s+p[0][k],0)/pairs.length,tx=pairs.reduce((s,p)=>s+p[1][k],0)/pairs.length,variance=pairs.reduce((s,p)=>s+(p[0][k]-sx)**2,0);scale[k]=variance<1e-12?1:pairs.reduce((s,p)=>s+(p[0][k]-sx)*(p[1][k]-tx),0)/variance;offset[k]=tx-scale[k]*sx;}
 const residual=Math.max(...pairs.flatMap(([a,b])=>a.map((x,k)=>Math.abs(x*scale[k]+offset[k]-b[k]))));if(residual>1e-6)throw Error('Native shared cube is not axis-affine: '+residual);return{scale,offset,residual};
}
const cases=[],matchesReport=[];
for(const[target,spec]of Object.entries(catalog))for(const[bindingName,binding]of Object.entries(spec.bindings)){
 const canonical=native.find(m=>m.modelLayerConstant===spec.modelLayer),canonicalBaked=canonical.states.find(s=>s.name==='baked'),refPart=canonicalBaked.parts.find(p=>p.path===binding.path),refCube=refPart.cubes[binding.cubeIndex];
 const activeQuads=sourceQuads.slice(0,binding.quads.length);
 const groupDir=path.join(out,target+'-'+bindingName);fs.mkdirSync(groupDir,{recursive:true});const exportedLayer=await exported(target,bindingName),texture=path.join(groupDir,'export.rgba');fs.writeFileSync(texture,exportedLayer.data);fs.writeFileSync(path.join(groupDir,'export.png'),exportedLayer.png);
 const variants=[spec.modelLayer,...(target==='horse_body'?['UNDEAD_HORSE_ARMOR']:target==='happy_ghast_body'?['HAPPY_GHAST_BABY_HARNESS']:target==='wings'?['ELYTRA_BABY']:[])];
 for(const variant of variants){const model=native.find(m=>m.modelLayerConstant===variant),baked=model.states.find(s=>s.name==='baked'),matches=matchingCubes(model,binding);if(matches.length!==(binding.repeats??1))throw Error(`${target}/${bindingName}/${variant}:matched${matches.length}expected${binding.repeats??1}`);
  // Frame each age/model variant independently, retaining the same camera for
  // its four poses. Baby harness root scale is 16x smaller than the adult's.
  const viewMatrix=model.states.find(s=>s.name==='rest').parts.find(p=>p.path===binding.path).modelMatrixColumnMajor;
  const axes=[norm(viewMatrix.slice(0,3)),norm(viewMatrix.slice(4,7)),norm(viewMatrix.slice(8,11))],rotate=p=>axes.map(axis=>dot(axis,p));
  const referenceCanonical=activeQuads.flat().map(p=>rotate(transform(viewMatrix,[p[0],-p[1],p[2]]))),center=[0,1,2].map(k=>(Math.min(...referenceCanonical.map(p=>p[k]))+Math.max(...referenceCanonical.map(p=>p[k])))/2),extent=Math.max(...[0,1].map(k=>Math.max(...referenceCanonical.map(p=>p[k]))-Math.min(...referenceCanonical.map(p=>p[k])))),viewScale=1.2/extent,view=p=>rotate(p).map((v,k)=>(v-center[k])*viewScale);
  const maps=matches.map(match=>{const part=baked.parts.find(p=>p.path===match.path);return{...match,map:cubeMap(refCube,spec.textureSize,part.cubes[match.cube],model.textureSize)};});matchesReport.push({target,binding:bindingName,variant,matches:maps});
  for(const state of model.states.filter(s=>s.name!=='baked')){const id=`${target}-${bindingName}-${variant}-${state.name}`,dir=path.join(groupDir,id);fs.mkdirSync(dir,{recursive:true});const carrier=[];
   for(const part of state.parts)if(part.effectivelyVisible)for(const cube of part.cubes)for(const face of cube.faces){const normal=norm(rotate(face.normalModel));for(const v of face.verticesModelBlocksUVNormalized)carrier.push(...view(v.slice(0,3)),v[3],v[4],...normal);}
   const nativeFile=path.join(dir,'native.f32');floats(nativeFile,carrier);const expected=[];
   for(const[repeat,match]of maps.entries()){const part=state.parts.find(p=>p.path===match.path);if(!part.effectivelyVisible)continue;const vertices=[];for(const quad of activeQuads)for(let c=0;c<4;c++){const p=[quad[c][0],-quad[c][1],quad[c][2]].map((v,k)=>v*match.map.scale[k]+match.map.offset[k]);vertices.push(...view(transform(part.modelMatrixColumnMajor,p)),uv[c][0],1-uv[c][1],0,0,1);}const file=path.join(dir,`expected-${repeat}.f32`);floats(file,vertices);expected.push([sourceTexture,32,32,file,vertices.length/8,1,0]);}
   cases.push({id,directory:dir,time:0,rgb:[255,255,255],expectedEmpty:expected.length===0,actual:[[texture,exportedLayer.width,exportedLayer.height,nativeFile,carrier.length/8,1,0]],expected,target,binding:bindingName,variant,pose:state.name,repeats:matches.length,view:{axes,center,scale:viewScale}});
  }
 }
}
fs.writeFileSync(path.join(out,'cases.matrix.tsv'),cases.map(c=>[c.id,c.time,c.rgb.join(','),c.expectedEmpty,c.actual.map(d=>d.join(';')).join('|'),c.expected.map(d=>d.join(';')).join('|'),c.directory].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),nativePath,vanillaRoot,pluginSHA256:crypto.createHash('sha256').update(fs.readFileSync('objcubed.js')).digest('hex'),catalogSHA256:crypto.createHash('sha256').update(fs.readFileSync('tools/equipment-carriers.json')).digest('hex'),sourceHashes,method:'Actual saveSingleOutput v2 descriptors and full native posed models. Expected source OBJ transformed by captured ModelPart matrices; repeats use full24vertex bind-cube axis-affine correspondence, independent of shader single-quad reconstruction. Stable canonical-view framing only. Synthetic hiddenGL, not live gameplay/FPS.',matches:matchesReport,cases},null,2));console.log('Prepared '+cases.length+' v2 cases');
