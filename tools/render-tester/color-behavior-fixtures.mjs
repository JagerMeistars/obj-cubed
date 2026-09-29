// CPU preparation for ColorBehaviorCheck.java. No Minecraft or window access.
// Exported PNG/carriers and current shaders versus the release 41bf938 decoder.
// Usage: node tools/render-tester/color-behavior-fixtures.mjs <out> <vanilla>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../../test/helpers/load-plugin.cjs');
const {makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/color-behavior');
const vanilla=path.resolve(process.argv[3]??'audit/2026-09-28/vanilla');
const root=path.resolve('objcubed');
fs.mkdirSync(out,{recursive:true});
const modes=['direct','time','scale','overlay','hurt'];
const old=Object.fromEntries(['main','tools','light'].map(n=>[n,execFileSync('git',['show',`41bf938:objcubed/assets/minecraft/shaders/include/objmc_${n}.glsl`],{encoding:'utf8'})]));
const replaceInclude=(text,name,value)=>text.replace(new RegExp('// begin <minecraft:'+name+'\\.glsl>[\\s\\S]*?// end <minecraft:'+name+'\\.glsl>'),()=>value);
const sourceHashes={};
for(const pipeline of ['item','entity','block','terrain'])for(const [suffix,stage]of [['vsh','vert'],['fsh','frag']]){
 const raw=expandShader(path.join(root,`assets/minecraft/shaders/core/${pipeline}.${suffix}`),[root,vanilla]);
 sourceHashes[`${pipeline}.${suffix}`]=crypto.createHash('sha256').update(raw).digest('hex');
 const current=raw.replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');
 const dir=path.join(out,pipeline);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'current.'+stage),current);
 let baseline=current;
 // The historical tools have no portable carrier helpers. Strip only the new
 // animal dispatcher from the historical reference; the current shader keeps
 // it. Color fixtures use existing item/humanoid markers, never marker 252.
 if(stage==='vert'&&baseline.includes('// begin <minecraft:objmc_animal.glsl>')){
  const dispatcher=/ivec4 ocEquipmentMarker = [^\n]+\n\s*if \(ocEquipmentMarker[^\n]+\n[\s\S]*?\/\/ end <minecraft:objmc_animal\.glsl>\s*}\s*else\s*{\s*(\/\/ begin <minecraft:objmc_main\.glsl>[\s\S]*?\/\/ end <minecraft:objmc_main\.glsl>)\s*}/;
  if(!dispatcher.test(baseline))throw Error('Unrecognized animal dispatcher in baseline wrapper');
  baseline=baseline.replace(dispatcher,(_,legacy)=>legacy);
 }
 for(const n of stage==='vert'?['tools','main']:['light'])baseline=replaceInclude(baseline,'objmc_'+n,old[n]);
 baseline=baseline.replace('GL_KHR_shader_subgroup_ballot','GL_KHR_shader_subgroup_quad');
 fs.writeFileSync(path.join(dir,'baseline.'+stage),baseline);
}
const size=32,white=Buffer.alloc(size*size*4,255),memfs=makeMemFs();
class Image {set src(_){queueMicrotask(()=>this.onload?.());}get naturalWidth(){return size;}get naturalHeight(){return size;}}
const {api}=loadObjcubedWithContext({requireImpl:id=>id==='fs'?memfs:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,
 console:{log(){},warn(){},error:console.error},
 document:{createElement(){return {getContext(){return {drawImage(){},getImageData(){return {data:white,width:size,height:size};}};}};}},
 Texture:{all:[{uuid:'u',name:'white',source:'data:fixture',img:{src:'data:fixture'}}]},Outliner:{root:[]},
 Blockbench:{export(){throw Error('unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:'color',export_path:''},BarItems:{}}});
function obj(frame){return ['usemtl m_u','o ocp1e0i0','vt .25 .25','vt .75 .25','vt .75 .75','vt .25 .75',
 ...[[-.35,.15,0],[.35,.15,0],[.35,.85,0],[-.35,.85,0]].map(([x,y,z])=>`v ${x+frame*.09} ${y} ${z}`),'f 1/1 2/2 3/3 4/4'].join('\n');}
const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:4,autoplay:false,easing:0,interpolation:0,noshadow:false,autorotate:0,visibility:7,displaySlots:{},flipuv:false,useAtlas:false,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:'color',exportAsEquipment:true,selectedPieces:['chestplate']};
const exp=await api.buildOutput(cfg,[0,1,2,3].map(obj),'');
await api.saveSingleOutput(exp,api.buildDisplayTransforms(cfg),cfg);
const equipment=[...memfs.writes].find(([name])=>name.endsWith('/humanoid/color_chestplate_0.png'));
if(!equipment)throw Error('Missing real equipment export');
const armor=PNG.sync.read(Buffer.from(equipment[1]));
function floats(file,v){const b=Buffer.alloc(v.length*4);v.forEach((x,i)=>b.writeFloatLE(x,i*4));fs.writeFileSync(file,b);}
const carrier=[];
for(const e of exp.elements){const[x0,y0,z0]=e.from,[x1,y1]=e.to,u=e.faces.north.uv;
 const pos=[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]],uv=[[u[0],u[1]],[u[0],u[3]],[u[2],u[3]],[u[2],u[1]]];
 for(let k=0;k<4;k++)carrier.push(...pos[k].map(a=>a/16-.5),...uv[k].map(a=>a/16));
}
floats(path.join(out,'item-carrier.f32'),carrier);
// Synthetic humanoid carriers use Minecraft's fixed 64x32 equipment UV layout.
// No previously generated audit fixtures are needed to reproduce this test.
function rotate(v){const x=5*Math.PI/180,y=-27*Math.PI/180;const[a,b,c]=v,d=a*Math.cos(y)+c*Math.sin(y),e=-a*Math.sin(y)+c*Math.cos(y);return[d,b*Math.cos(x)-e*Math.sin(x),b*Math.sin(x)+e*Math.cos(x)];}
const armorVertices=[];
for(const p of [{o:[16,16],s:[8,12,4],at:0},{o:[40,16],s:[4,12,4],at:-.43},{o:[40,16],s:[4,12,4],at:.43,mirror:true}]){
 const[w,h,d]=p.s,[ox,oy]=p.o,lo=[-(w+2)/32,-(h+2)/32,-(d+2)/32],hi=lo.map(x=>-x);
 const faces=[
  {v:[[hi[0],lo[1],hi[2]],[lo[0],lo[1],hi[2]],[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]]],uv:[ox+d+w,oy,ox+d+2*w,oy+d],n:[0,1,0]},
  {v:[[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],[lo[0],hi[1],hi[2]],[hi[0],hi[1],hi[2]]],uv:[ox+d,oy,ox+d+w,oy+d],n:[0,-1,0]},
  {v:[[lo[0],lo[1],lo[2]],[lo[0],lo[1],hi[2]],[lo[0],hi[1],hi[2]],[lo[0],hi[1],lo[2]]],uv:[ox,oy+d,ox+d,oy+d+h],n:[-1,0,0]},
  {v:[[hi[0],lo[1],lo[2]],[lo[0],lo[1],lo[2]],[lo[0],hi[1],lo[2]],[hi[0],hi[1],lo[2]]],uv:[ox+d,oy+d,ox+d+w,oy+d+h],n:[0,0,-1]},
  {v:[[hi[0],lo[1],hi[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[hi[0],hi[1],hi[2]]],uv:[ox+d+w,oy+d,ox+2*d+w,oy+d+h],n:[1,0,0]},
  {v:[[lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]],uv:[ox+2*d+w,oy+d,ox+2*d+2*w,oy+d+h],n:[0,0,1]},
 ];
 for(const face of faces){const[u0,v0,u1,v1]=face.uv,uv=[[u1,v0],[u0,v0],[u0,v1],[u1,v1]];
  for(let k=0;k<4;k++){const v=[...face.v[k]],n=[...face.n];if(p.mirror){v[0]*=-1;n[0]*=-1;}v[0]+=p.at;armorVertices.push(...rotate(v),uv[k][0]/64,uv[k][1]/32,...rotate(n));}
 }
}
floats(path.join(out,'armor-carrier.f32'),armorVertices);
fs.writeFileSync(path.join(out,'source-frame0.obj'),obj(0));
fs.writeFileSync(path.join(out,'item-export.png'),exp.pngBuffer);
fs.writeFileSync(path.join(out,'armor-export.png'),Buffer.from(equipment[1]));
const samples=[{name:'rgb',rgb:[80,144,208]}];
const cases=[];
function add(cb,sample){for(const fullbright of [0,1])for(const pipeline of ['item','entity','block','terrain','armor']){
 const code=(cb[0]<<6)|(cb[1]<<3)|cb[2],id=`${pipeline}-${cb.join('')}-${sample.name}-${fullbright?'fullbright':'lit'}`;
 const isArmor=pipeline==='armor',data=Buffer.from(isArmor?armor.data:exp.rawBuf);
 data[24]=(data[24]&126)|(fullbright?128:0)|((code>>8)&1);data[25]=code&255;
 const file=id+'.rgba';fs.writeFileSync(path.join(out,file),data);
 cases.push({id,pipeline,modes:cb.map(n=>modes[n]),code,rgb:sample.rgb,fullbright:!!fullbright,texture:file,width:isArmor?armor.width:exp.tw,height:isArmor?armor.height:exp.ty,time:sample.time??1.25});
}}
for(let r=0;r<5;r++)for(let g=0;g<5;g++)for(let b=0;b<5;b++)for(const sample of samples)add([r,g,b],sample);
for(let m=0;m<5;m++)for(const sample of [{name:'zero',rgb:[0,0,0]},{name:'white',rgb:[255,255,255]}])add([m,m,m],sample);
for(const sample of [{name:'manual1',rgb:[128,0,1]},{name:'manual3',rgb:[128,0,3]},{name:'auto1',rgb:[0,0,1],time:2},{name:'once1',rgb:[0,128,0],time:1}])add([1,1,1],sample);
fs.writeFileSync(path.join(out,'cases.tsv'),cases.map(c=>[c.id,c.pipeline,c.texture,c.width,c.height,c.rgb.join(','),c.fullbright?1:0,c.time].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),baseline:'41bf938',sourceHashes,modes,cases,methodology:'Real exported four-frame white quad; real box-packed equipment PNG with the previously verified synthetic humanoid carrier. Current expanded production shaders through ShaderC Vulkan1.2/SPIRV-Cross vs original main/tools/light includes compiled through native GL in current uniform wrappers. RGB constant vertex attributes; no game tints, atlas stitching, OIT, or gameplay test. EMISSIVE define bypasses only external lightmap texture; model noshadow flag separately tested. All 125 combinations plus boundaries. Item/armor assembly scheduling remains synthetic.'},null,2));
console.log(`Prepared ${cases.length} GPU color cases at ${out}`);
