// Texture animation oracle: independently select/mix source RGBA frames, then
// export that result as STATIC textures. The GPU compares actual animation to
// this static reference through the same geometry decoder. No shader decoding
// formula or encoded header is used to construct expected image pixels.
// Usage: node tools/render-tester/texture-animation-fixtures.mjs <out> <vanilla> [plugin-source]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const require=createRequire(import.meta.url);
const {loadPlugin}=require('../../test/helpers/load-plugin.cjs');
const {makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/texture-animation');
const vanilla=path.resolve(process.argv[3]??'audit/2026-09-28/vanilla');
const plugin=path.resolve(process.argv[4]??'objcubed.js');
fs.mkdirSync(out,{recursive:true});
const sourceRoot=path.resolve('objcubed'),sourceHashes={};
for(const pipeline of ['item','entity'])for(const[suffix,stage]of[['vsh','vert'],['fsh','frag']]){
 let text=expandShader(path.join(sourceRoot,`assets/minecraft/shaders/core/${pipeline}.${suffix}`),[sourceRoot,vanilla]);
 sourceHashes[`${pipeline}.${suffix}`]=crypto.createHash('sha256').update(text).digest('hex');
 text=text.replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');
 fs.writeFileSync(path.join(out,pipeline+'.'+stage),text);
}
function image(frames,material,frameHeight=32){const width=32,height=frameHeight*frames,data=Buffer.alloc(width*height*4);
 const colors=[[230,40,60],[30,200,80],[50,70,225],[220,180,35],[175,55,200]];
 for(let f=0;f<frames;f++)for(let y=0;y<frameHeight;y++)for(let x=0;x<width;x++){
  const c=colors[(f+material)%colors.length],delta=(x<width/2?0:12)+(y<frameHeight/2?0:24);
  data.set([...c.map(v=>Math.max(0,v-delta)),255],((f*frameHeight+y)*width+x)*4);
 }
 return {width,height,data,frames,frameHeight};
}
function selectedImage(src,time,frametime,fade){
 const frame=Math.floor(time/frametime)%src.frames,next=(frame+1)%src.frames,mix=fade?(time%frametime)/frametime:0;
 const data=Buffer.alloc(src.width*src.frameHeight*4);
 for(let i=0;i<data.length;i++)data[i]=Math.round(src.data[frame*data.length+i]*(1-mix)+src.data[next*data.length+i]*mix);
 return {width:src.width,height:src.frameHeight,frameHeight:src.frameHeight,data,frames:1,selected:{frame,next,mix}};
}
function load(images,scenario){const memfs=makeMemFs();
 class Image{set src(s){this.index=Number(s.split(':').at(-1));queueMicrotask(()=>this.onload?.());}get naturalWidth(){return images[this.index].width;}get naturalHeight(){return images[this.index].height;}}
 const api=loadPlugin(plugin,{requireImpl:id=>id==='fs'?memfs:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,
  console:{log(){},warn(){},error:console.error},document:{createElement(){let image;return {getContext(){return {drawImage(i){image=i;},getImageData(){return images[image.index];}};}};}},
  ...(scenario.formatFalse?{Format:{animated_textures:false}}:{}),
  Texture:{all:images.map((im,i)=>({uuid:'t'+i,name:'texture'+i,source:'data:'+i,img:{src:'data:'+i},...(scenario.metadataFree?{}:scenario.formatFalse?{uv_height:16,uv_width:16,frameCount:undefined}:scenario.modern?{uv_height:16*im.frameHeight/im.width,uv_width:16,frameCount:im.frames>1?im.frames:undefined,display_height:im.frameHeight}:{uv_height:im.frameHeight,frame_count:im.frames})}))},Outliner:{root:[]},
  Blockbench:{export(){throw Error('unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:'texture',export_path:''},BarItems:{}}});
 return {api,memfs};
}
function obj(materials,geometryFrame){const lines=[];let n=1;for(let m=0;m<materials;m++){
 const x=(m%2)*.75-.70+geometryFrame*.06,y=Math.floor(m/2)*.70+.10;
 lines.push(`o ocp1e0i${m}`,`usemtl m_t${m}`);
 for(const p of [[x,y,0],[x+.6,y,0],[x+.6,y+.55,0],[x,y+.55,0]])lines.push('v '+p.join(' '));
 // Include the frame edges; the atlas shader must select a band per face, not per corner.
 for(const uv of [[0,0],[1,0],[1,1],[0,1]])lines.push('vt '+uv.join(' '));
 lines.push('f '+[0,1,2,3].map(k=>`${n+k}/${n+k}`).join(' '));n+=4;
 }return lines.join('\n');}
function floats(file,values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(file,b);}
function itemCarrier(elements){const vertices=[];for(const e of elements){const[x0,y0,z0]=e.from,[x1,y1]=e.to,u=e.faces.north.uv;
 const p=[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]],uv=[[u[0],u[1]],[u[0],u[3]],[u[2],u[3]],[u[2],u[1]]];
 for(let k=0;k<4;k++)vertices.push(...p[k].map(v=>v/16-.5),...uv[k].map(v=>v/16));}return vertices;}
// Inflated humanoid torso, six faces in the vanilla 64x32 equipment UV layout.
const lo=[-10/32,-14/32,-6/32],hi=lo.map(v=>-v),armor=[];
const faces=[
 {v:[[hi[0],lo[1],hi[2]],[lo[0],lo[1],hi[2]],[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]]],uv:[28,16,36,20],n:[0,1,0]},
 {v:[[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],[lo[0],hi[1],hi[2]],[hi[0],hi[1],hi[2]]],uv:[20,16,28,20],n:[0,-1,0]},
 {v:[[lo[0],lo[1],lo[2]],[lo[0],lo[1],hi[2]],[lo[0],hi[1],hi[2]],[lo[0],hi[1],lo[2]]],uv:[16,20,20,32],n:[-1,0,0]},
 {v:[[hi[0],lo[1],lo[2]],[lo[0],lo[1],lo[2]],[lo[0],hi[1],lo[2]],[hi[0],hi[1],lo[2]]],uv:[20,20,28,32],n:[0,0,-1]},
 {v:[[hi[0],lo[1],hi[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[hi[0],hi[1],hi[2]]],uv:[28,20,32,32],n:[1,0,0]},
 {v:[[lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]],uv:[32,20,40,32],n:[0,0,1]},
];
for(const f of faces){const[u0,v0,u1,v1]=f.uv,uv=[[u1,v0],[u0,v0],[u0,v1],[u1,v1]];for(let k=0;k<4;k++)armor.push(...f.v[k],uv[k][0]/64,uv[k][1]/32,...f.n);}
floats(path.join(out,'armor-carrier.f32'),armor);
const scenarios=[
 {name:'single_strip',frames:[3]},
 {name:'single_strip_flip',frames:[3],flip:true},
 {name:'single_strip_fade',frames:[3],fade:true},
 {name:'single_strip_slow',frames:[3],ft:5},
 {name:'static_atlas',frames:[1,1,1],static:true},
 {name:'static_atlas_flip',frames:[1,1,1],static:true,flip:true},
 {name:'animated_static',frames:[3,1]},
 {name:'animated_static_flip',frames:[3,1],flip:true},
 {name:'animated_static_fade',frames:[3,1],fade:true},
 {name:'two_strips',frames:[2,3]},
 {name:'three_strips_fade',frames:[2,3,4],fade:true},
 {name:'four_strips',frames:[2,3,4,5]},
 {name:'four_strips_flip_fade',frames:[2,3,4,5],flip:true,fade:true},
 {name:'independent_clocks',frames:[3,1],fade:true,geometry:true},
 {name:'modern_bb_animated_static',frames:[3,1],modern:true},
 {name:'modern_bb_flip_fade',frames:[3,1],modern:true,flip:true,fade:true},
 {name:'modern_bb_four_strips',frames:[2,3,4,5],modern:true,fade:true},
 {name:'modern_single_rectangle',frames:[3],heights:[16],modern:true,fade:true},
 {name:'modern_rectangle_atlas_flip',frames:[3,2],heights:[16,32],modern:true,fade:true,flip:true},
 {name:'native_tall_static_neighbor',frames:[3,1],heights:[32,96],modern:true,fade:true},
 {name:'format_false_fallback',frames:[3,1],formatFalse:true,fade:true},
 {name:'metadata_free_fallback',frames:[3,1],metadataFree:true},
];
async function exported(images,scenario,animate){const {api,memfs}=load(images,scenario);const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:scenario.geometry?['time','time','time']:['direct','direct','direct'],duration:4,autoplay:false,easing:0,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots:{},flipuv:!!scenario.flip,useAtlas:images.length>1,atlasTexIndices:images.map((_,i)=>i),texAnimEnabled:animate,texFrametime:scenario.ft??2,texFade:!!scenario.fade,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:'texture',exportAsEquipment:true,selectedPieces:['chestplate']};
 const exp=await api.buildOutput(cfg,(scenario.geometry?[0,1,2,3]:[0]).map(f=>obj(images.length,f)),'');await api.saveSingleOutput(exp,api.buildDisplayTransforms(cfg),cfg);
 const equipment=[...memfs.writes].filter(([name])=>/\/humanoid\/texture_chestplate_\d+\.png$/.test(name));if(equipment.length!==1)throw Error('Expected one torso layer for at most four faces, got '+equipment.length);
 return {item:{data:exp.rawBuf,width:exp.tw,height:exp.ty,png:exp.pngBuffer,vertices:itemCarrier(exp.elements)},armor:{...PNG.sync.read(Buffer.from(equipment[0][1])),png:Buffer.from(equipment[0][1]),vertices:armor}};
}
const cases=[];
for(const scenario of scenarios){const dir=path.join(out,scenario.name);fs.mkdirSync(dir,{recursive:true});const images=scenario.frames.map((f,i)=>image(f,i,scenario.heights?.[i]??32)),actual=await exported(images,scenario,!scenario.static);
 images.forEach((im,i)=>fs.writeFileSync(path.join(dir,'source'+i+'.png'),PNG.sync.write(im)));
 for(const context of ['item','armor']){const e=actual[context];fs.writeFileSync(path.join(dir,context+'.rgba'),e.data);fs.writeFileSync(path.join(dir,context+'.png'),e.png);floats(path.join(dir,context+'.f32'),e.vertices);}
 const ft=scenario.ft??2,times=[0,ft*.5,ft,ft*2,ft*2.5,ft*3,ft*5,ft*12];
 for(const [ti,time]of times.entries())for(const pipeline of ['item','entity','armor','gui'])for(const geometryFrame of scenario.geometry?[0,3]:[0]){
  const id=`${scenario.name}-${pipeline}-t${ti}-g${geometryFrame}`,cdir=path.join(dir,id);fs.mkdirSync(cdir,{recursive:true});
  const referenceImages=images.map(im=>selectedImage(im,pipeline==='gui'?0:time,ft,!!scenario.fade));
  const reference=await exported(referenceImages,scenario,false),kind=pipeline==='armor'?'armor':'item',r=reference[kind],a=actual[kind];
  fs.writeFileSync(path.join(cdir,'expected.rgba'),r.data);fs.writeFileSync(path.join(cdir,'expected.png'),r.png);floats(path.join(cdir,'expected.f32'),r.vertices);
  cases.push({id,pipeline,scenario:scenario.name,time,geometryFrame,rgb:scenario.geometry?[128,0,geometryFrame]:[255,255,255],actual:{texture:path.join(dir,kind+'.rgba'),geometry:path.join(dir,kind+'.f32'),width:a.width,height:a.height,count:a.vertices.length/(kind==='armor'?8:5)},expected:{texture:path.join(cdir,'expected.rgba'),geometry:path.join(cdir,'expected.f32'),width:r.width,height:r.height,count:r.vertices.length/(kind==='armor'?8:5)},directory:cdir,selectedFrames:referenceImages.map(im=>im.selected)});
 }
}
fs.writeFileSync(path.join(out,'cases.tsv'),cases.map(c=>[c.id,c.pipeline,c.time,c.rgb.join(','),c.actual.texture,c.actual.geometry,c.actual.width,c.actual.height,c.actual.count,c.expected.texture,c.expected.geometry,c.expected.width,c.expected.height,c.expected.count,c.directory].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),pluginSource:plugin,pluginSHA256:crypto.createHash('sha256').update(fs.readFileSync(plugin)).digest('hex'),sourceHashes,scenarios,cases,methodology:'Actual real buildOutput/saveSingleOutput export vs static export of independently time-selected/mixed source RGBA frames. Shared geometry decoder; no original-shader oracle. Pattern distinguishes material, frame, X half and Y half. GUI expects frame0. Geometry RGB24 freeze tested at two poses with the same texture GameTime. Synthetic carriers and hidden OpenGL; not gameplay.'},null,2));
console.log(`Prepared ${cases.length} texture-animation GPU cases at ${out}`);
