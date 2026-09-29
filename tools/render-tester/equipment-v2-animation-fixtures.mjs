// Actual v2 exports versus original source images/OBJ and native ModelPart poses.
// Generate equipment-v2-fixtures.mjs first: its native carrier/view files are
// reused, never its rendered pixels or the shader's single-quad pose decoder.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
import {floats,uv} from './horse-fixture-library.mjs';
const require=createRequire(import.meta.url),{loadPlugin}=require('../../test/helpers/load-plugin.cjs'),{makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/2026-09-29/equipment-expansion/v2-animation');
const baseDirectory=path.resolve(process.argv[3]??'audit/2026-09-29/equipment-expansion/v2-gpu-final');
fs.mkdirSync(out,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(baseDirectory,'manifest.json'),'utf8'));
const catalog=JSON.parse(fs.readFileSync('tools/equipment-carriers.json','utf8'));
const nativePath=base.nativePath??path.resolve('audit/2026-09-29/equipment-expansion/native-models.json');
const vanillaRoot=base.vanillaRoot??path.resolve('audit/2026-09-28/vanilla');
const native=JSON.parse(fs.readFileSync(nativePath,'utf8')).models;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),sourceHashes={};
for(const[ext,stage]of[['vsh','vert'],['fsh','frag']]){
 const expanded=expandShader(path.resolve('objcubed/assets/minecraft/shaders/core/entity.'+ext),[path.resolve('objcubed'),vanillaRoot]).replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');
 fs.writeFileSync(path.join(out,'entity.'+stage),expanded);sourceHashes[ext]=hash(expanded);
}
const pivot=[.17,-.23,.11];
const scenarios=[
 {name:'strip2',frames:[3],geometryFrames:2,easing:1,atlas:false},
 {name:'atlas4',frames:[2,3,1],geometryFrames:4,easing:1,atlas:true},
 {name:'atlas4_flip_cubic_fade',frames:[2,3,4,5,1],geometryFrames:4,easing:3,atlas:true,flip:true,fade:true},
];
function image(frames,material){
 const width=32,height=32*frames,data=Buffer.alloc(width*height*4),colors=[[230,55,85],[50,215,100],[65,90,230],[220,190,50],[170,75,205]];
 for(let f=0;f<frames;f++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
  const c=colors[(f+material)%colors.length],delta=(x<16?0:12)+(y<16?0:24);
  data.set([...c.map(v=>v-delta),255],((f*32+y)*32+x)*4);
 }
 return{width,height,data,frames};
}
function panels(count,frame){
 const columns=count/2,width=1.15/columns,result=[];
 for(let f=0;f<count;f++){
  const x=f%columns*width-.58+frame*.013,y=Math.floor(f/columns)*.4-.2+frame*.019,z=.03+frame*.011;
  result.push([[x,y,z],[x+width*.83,y,z+.015],[x+width*.83,y+.33,z+.026],[x,y+.33,z+.011]].map(p=>p.map((v,k)=>v+pivot[k])));
 }
 return result;
}
function obj(quads,materials,emission=false){
 const rows=[];for(let f=0;f<quads.length;f++){
  rows.push(`o ocp1e${emission&&f%2?15:0}i${f}`,`usemtl m_t${f%materials}`);
  for(const p of quads[f])rows.push('v '+p.join(' '));for(const p of uv)rows.push('vt '+p.join(' '));
  rows.push('f '+[0,1,2,3].map(k=>`${f*4+k+1}/${f*4+k+1}`).join(' '));
 }return rows.join('\n');
}
async function exported(target,binding,scenario,options={}){
 const images=scenario.frames.map(image),memory=makeMemFs();
 class Image{set src(s){this.index=Number(s.split(':').at(-1));queueMicrotask(()=>this.onload?.());}get naturalWidth(){return images[this.index].width;}get naturalHeight(){return images[this.index].height;}}
 const api=loadPlugin(path.resolve('objcubed.js'),{
  requireImpl:id=>id==='fs'?memory:id==='path'?{...path,...path.posix}:require(id),
  globals:{Buffer,Image,setTimeout,process,console:{log(){},warn(){},error:console.error},
   document:{createElement(){let selected;return{getContext(){return{drawImage(i){selected=i;},getImageData(){return images[selected.index];}};}};}},
   Texture:{all:images.map((im,i)=>({uuid:'t'+i,name:'material'+i,source:'data:'+i,img:{src:'data:'+i},uv_width:16,uv_height:16,frameCount:im.frames,display_height:32}))},
   Outliner:{root:[]},Blockbench:{export(){throw Error('Unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:'v2_animation',export_path:''},BarItems:{}}
 });
 const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],duration:4,autoplay:true,easing:scenario.easing,interpolation:0,noshadow:!options.emission,autorotate:0,visibility:7,displaySlots:{},flipuv:!!scenario.flip,useAtlas:scenario.atlas,atlasTexIndices:images.map((_,i)=>i),texAnimEnabled:true,texFrametime:2,texFade:!!scenario.fade,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:'v2_'+target+'_'+binding+'_'+scenario.name,exportAsEquipment:true,equipmentTarget:target,selectedPieces:[]};
 const frames=Array.from({length:scenario.geometryFrames},(_,i)=>panels(Math.max(6,images.length*2),i));
 const result=await api.buildOutput(cfg,frames.map(q=>obj(q,images.length,options.emission)),'');
 result.faceToEquipmentBinding=Array.from({length:result.nfaces},()=>({part:binding,pivot,key:'fixture'}));
 await api.saveSingleOutput(result,api.buildDisplayTransforms(cfg),cfg);
 const layers=[...memory.writes].filter(([file])=>file.includes(`/textures/entity/equipment/${target}/`)&&file.endsWith('.png')).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([filename,data])=>({filename,png:Buffer.from(data),...PNG.sync.read(Buffer.from(data))}));
 if(layers.length!==Math.ceil(frames[0].length/catalog[target].bindings[binding].quads.length)||layers.some(l=>l.data[35]!==2))throw Error('Unexpected v2 layer packing');
 return{cfg,frames,images,layers};
}
const transform=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]);
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
function position(point,part,map,view){
 const local=[point[0]-pivot[0],-(point[1]-pivot[1]),point[2]-pivot[2]].map((v,k)=>v*map.scale[k]+map.offset[k]);
 const world=transform(part.modelMatrixColumnMajor,local);return view.axes.map((axis,k)=>(dot(axis,world)-view.center[k])*view.scale);
}
function animated(frames,clock,easing){
 const at=Math.floor(clock)%frames.length,t=clock-Math.floor(clock);
 return frames[at].map((q,f)=>q.map((p,c)=>p.map((v,k)=>{
  const p1=frames[(at+1)%frames.length][f][c][k];
  if(easing===3){const p2=frames[(at+2)%frames.length][f][c][k],p3=frames[(at+3)%frames.length][f][c][k];return .5*(2*p1+(-v+p2)*t+(2*v-5*p1+4*p2-p3)*t*t+(-v+3*p1-3*p2+p3)*t*t*t);}
  return v*(1-t)+p1*t;
 })));
}
function shade(q){
 const a=q[1].map((v,k)=>v-q[0][k]),b=q[2].map((v,k)=>v-q[0][k]);
 let n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);n=n.map(v=>v/length);
 if(dot(n,[0,0,3].map((v,k)=>v-q[0][k]))<0)n=n.map(v=>-v);
 return Math.min(1,.4+.6*(Math.max(0,-n[1])+Math.max(0,-n[2])));
}
const cases=[],selected=Object.entries(catalog).map(([target,spec])=>[target,spec.defaultBinding]);
for(const pair of [['horse_body','head'],['horse_body','legs'],['wolf_body','legs'],['llama_body','legs'],['pig_saddle','legs'],['happy_ghast_body','goggles'],['camel_saddle','reins'],['camel_husk_saddle','reins'],['camel_saddle','left_ear'],['camel_saddle','right_ear'],['camel_husk_saddle','left_ear'],['camel_husk_saddle','right_ear']])selected.push(pair);
const guards=['kind','signature','slots','reserved','row-beyond','row-overlap','truncated','empty','index','nan-pivot','nan-rect','zero-basis','nan-normal'];
function corrupt(layer,guard){
 const data=Buffer.from(layer.data),row=data[56]*256+data[57],scalar=i=>row*layer.width*4+i*4;
 if(guard==='kind')data[39]=1;if(guard==='signature')data[60]=0;if(guard==='slots')data[58]=5;if(guard==='reserved')data[59]=1;
 if(guard==='row-beyond'){data[56]=Math.floor(layer.height/256);data[57]=layer.height%256;}
 if(guard==='row-overlap'){data[56]=0;data[57]=2;}
 if(guard==='truncated'){const r=layer.height-1;data[56]=Math.floor(r/256);data[57]=r%256;}
 if(guard==='empty'||guard==='index')for(let f=0;f<6;f++){data[(8+f)*4]=guard==='empty'?255:127;data[(8+f)*4+1]=255;}
 if(guard==='nan-pivot')data.writeFloatLE(NaN,scalar(96));
 if(guard==='nan-rect')for(let f=0;f<6;f++)data.writeFloatLE(NaN,scalar(f*16));
 if(guard==='zero-basis')for(let f=0;f<6;f++)for(let k=0;k<3;k++)data.copy(data,scalar(f*16+7+k),scalar(f*16+4+k),scalar(f*16+5+k));
 if(guard==='nan-normal')for(let f=0;f<6;f++)data.writeFloatLE(NaN,scalar(f*16+13));
 return data;
}
async function addSeries(target,binding,scenario,options={}){
 const pose=catalog[target].bindings[binding].visibleWhen==='ridden'||/^(left|right)_ear$/.test(binding)?'moving':'rest';
 const variant=catalog[target].modelLayer,baseCase=base.cases.find(c=>c.target===target&&c.binding===binding&&c.variant===variant&&c.pose===pose);
 const maps=base.matches.find(m=>m.target===target&&m.binding===binding&&m.variant===variant).matches;
 const nativeState=native.find(m=>m.modelLayerConstant===variant).states.find(s=>s.name===pose);
 const model=await exported(target,binding,scenario,options),label=[target,binding,scenario.name,options.emission?'emission':null].filter(Boolean).join('-');
 const dir=path.join(out,label);fs.mkdirSync(dir,{recursive:true});
 const actual=model.layers.map((layer,i)=>{const texture=path.join(dir,`layer-${i}.rgba`);fs.writeFileSync(texture,layer.data);fs.writeFileSync(path.join(dir,`layer-${i}.png`),layer.png);return[texture,layer.width,layer.height,baseCase.actual[0][3],baseCase.actual[0][4],1,0];});
 const clockCases=options.emission?[[0,'manual0']]:[...([0,.5,2,5,12].flatMap(t=>['manual0','manualLast','autoplay'].map(m=>[t,m]))),[.5,'overflow']];
 for(const[time,mode]of clockCases){
  const id=label+`-t${time}-${mode}`,directory=path.join(dir,id);fs.mkdirSync(directory,{recursive:true});
  const clock=mode==='autoplay'?time*scenario.geometryFrames/4:mode==='manual0'?0:scenario.geometryFrames-1;
  const selectedFrames=[],textures=model.images.map((im,i)=>{
   const frame=Math.floor(time/2)%im.frames,next=(frame+1)%im.frames,mix=scenario.fade?(time%2)/2:0,data=Buffer.alloc(32*32*4);
   for(let p=0;p<data.length;p++)data[p]=Math.round(im.data[frame*data.length+p]*(1-mix)+im.data[next*data.length+p]*mix);
   const file=path.join(directory,`source-material-${i}.rgba`);fs.writeFileSync(file,data);selectedFrames.push({material:i,frame,next,mix});return file;
  });
  const expected=[],mesh=animated(model.frames,clock,scenario.easing);
  for(const[repeat,match]of maps.entries()){
   const part=nativeState.parts.find(p=>p.path===match.path);if(!part.effectivelyVisible)continue;
   for(let face=0;face<mesh.length;face++){
    const q=mesh[face].map(p=>position(p,part,match.map,baseCase.view)),vertices=[];
    for(let c=0;c<4;c++)vertices.push(...q[c],uv[c][0],scenario.flip?uv[c][1]:1-uv[c][1],0,0,1);
    const file=path.join(directory,`reference-${repeat}-${face}.f32`);floats(file,vertices);
    expected.push([textures[face%model.images.length],32,32,file,4,options.emission&&face%2===0?shade(q):1,0]);
   }
  }
  const control=mode==='overflow'?99:mode==='manualLast'?(scenario.geometryFrames-1)*4/scenario.geometryFrames:0;
  const rgb=mode==='autoplay'?[255,255,255]:[128,0,control];
  cases.push({id,directory,time,rgb,expectedEmpty:false,actual,expected,target,binding,scenario:scenario.name,selectedFrames,geometry:{clock,frames:scenario.geometryFrames,easing:scenario.easing,pivot},emission:!!options.emission});
 }
 if(options.guards)for(const guard of guards){
  const id=label+'-guard-'+guard,directory=path.join(dir,id);fs.mkdirSync(directory,{recursive:true});
  const guarded=model.layers.map((layer,i)=>{const texture=path.join(directory,`layer-${i}.rgba`);fs.writeFileSync(texture,corrupt(layer,guard));return[texture,layer.width,layer.height,baseCase.actual[0][3],baseCase.actual[0][4],1,0];});
  cases.push({id,directory,time:0,rgb:[255,255,255],expectedEmpty:true,actual:guarded,expected:[],target,binding,guard});
 }
}
for(const[target,binding]of selected){
 for(const scenario of scenarios)await addSeries(target,binding,scenario,{guards:scenario.name==='strip2'});
 await addSeries(target,binding,{...scenarios[0],name:'emission',frames:[1],geometryFrames:2},{emission:true});
}
fs.writeFileSync(path.join(out,'cases.matrix.tsv'),cases.map(c=>[c.id,c.time,c.rgb.join(','),c.expectedEmpty,c.actual.map(d=>d.join(';')).join('|'),c.expected.map(d=>d.join(';')).join('|'),c.directory].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),pluginSHA256:hash(fs.readFileSync('objcubed.js')),catalogSHA256:hash(fs.readFileSync('tools/equipment-carriers.json')),nativePath,vanillaRoot,nativeSHA256:hash(fs.readFileSync(nativePath)),baseManifest:baseDirectory,baseManifestSHA256:hash(fs.readFileSync(path.join(baseDirectory,'manifest.json'))),sourceHashes,scenarios,selected,pivot,method:'Actual buildOutput/saveSingleOutput v2 exports. Expected original source OBJ minus artist pivot, full native cube correspondence and captured ModelPart transform; original un-atlased RGBA frame sampling. Emission uses mathematical native lighting. Guarded files intentionally corrupt bytes after export. HiddenGL correctness only, not Minecraft gameplay/FPS.',cases},null,2));
console.log('Prepared '+cases.length+' v2 animation/atlas/pivot/guard cases');
