// Horse-specific atlas oracle. Expected pixels sample original source images;
// expected vertices use source OBJ coordinates and a real native body matrix.
// This generator is CPU-only. Run horse-equipment-check.ps1 separately.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
import {floats,uv} from './horse-fixture-library.mjs';
const require=createRequire(import.meta.url),{loadPlugin}=require('../../test/helpers/load-plugin.cjs'),{makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const out=path.resolve(process.argv[2]??'audit/2026-09-29/horse-atlas-0.8.5');fs.mkdirSync(out,{recursive:true});
const liveOnly=process.argv.includes('--live-pack-only'),livePack=path.join(out,'live-pack');
const source=path.resolve('objcubed'),sourceHashes={};
for(const[ext,stage]of[['vsh','vert'],['fsh','frag']]){const expanded=expandShader(path.join(source,'assets/minecraft/shaders/core/entity.'+ext),[source,path.resolve('audit/2026-09-28/vanilla')]).replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');fs.writeFileSync(path.join(out,'entity.'+stage),expanded);sourceHashes[ext]=crypto.createHash('sha256').update(expanded).digest('hex');}
const poses=JSON.parse(fs.readFileSync('audit/2026-09-29/animal-equipment/native-poses.json','utf8')).poses;
const scenarios=[
 {name:'two_strips',frames:[2,3]},
 {name:'two_strips_static',frames:[2,3,1]},
 {name:'two_strips_static_flip',frames:[2,3,1],flip:true},
 {name:'two_strips_static_fade',frames:[2,3,1],fade:true},
 {name:'two_strips_static_flip_fade',frames:[2,3,1],flip:true,fade:true},
 {name:'four_strips_static_flip_fade',frames:[2,3,4,5,1],flip:true,fade:true},
];
function image(frames,material){const width=32,frameHeight=32,height=frames*frameHeight,data=Buffer.alloc(width*height*4),colors=[[230,55,85],[50,215,100],[65,90,230],[220,190,50],[170,75,205]];for(let f=0;f<frames;f++)for(let y=0;y<frameHeight;y++)for(let x=0;x<width;x++){const c=colors[(f+material)%colors.length],delta=(x<16?0:12)+(y<16?0:24);data.set([...c.map(v=>v-delta),255],((f*frameHeight+y)*width+x)*4);}return{width,height,frameHeight,frames,data};}
function panels(materialCount,frame){const result=[];for(let i=0;i<materialCount*2;i++){const x=(i%materialCount)*.35-materialCount*.175+.03+frame*.025,y=Math.floor(i/materialCount)*.4+.08+frame*.035;result.push([[x,y,0],[x+.29,y,0],[x+.29,y+.31,0],[x,y+.31,0]]);}return result;}
function obj(quads,materials){const lines=[];for(let f=0;f<quads.length;f++){lines.push(`o ocp1e0i${f}`,`usemtl m_t${f%materials}`);for(const p of quads[f])lines.push('v '+p.join(' '));for(const v of uv)lines.push('vt '+v.join(' '));lines.push('f '+[0,1,2,3].map(k=>`${f*4+k+1}/${f*4+k+1}`).join(' '));}return lines.join('\n');}
async function exported(scenario,kind,images){const memory=makeMemFs();class Image{set src(s){this.index=Number(s.split(':').at(-1));queueMicrotask(()=>this.onload?.());}get naturalWidth(){return images[this.index].width;}get naturalHeight(){return images[this.index].height;}}
 const api=loadPlugin(path.resolve('objcubed.js'),{requireImpl:id=>id==='fs'?memory:id==='path'?{...path,...path.posix}:require(id),globals:{Buffer,Image,setTimeout,process,console:{log(){},warn(){},error:console.error},document:{createElement(){let image;return{getContext(){return{drawImage(i){image=i;},getImageData(){return images[image.index];}};}};}},Texture:{all:images.map((im,i)=>({uuid:'t'+i,name:'material'+i,source:'data:'+i,img:{src:'data:'+i},uv_height:16,uv_width:16,frameCount:im.frames,display_height:32}))},Outliner:{root:[]},Blockbench:{export(){throw Error('Unexpected dialog');},pickDirectory(){return '/rp';}},Project:{name:scenario.name,export_path:''},BarItems:{}}});
 const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],duration:4,autoplay:true,easing:1,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots:{},flipuv:!!scenario.flip,useAtlas:true,atlasTexIndices:images.map((_,i)=>i),texAnimEnabled:true,texFrametime:2,texFade:!!scenario.fade,resourcePackDir:'/rp',baseItem:'stick',generateDatapack:false,cmdName:scenario.name+'_'+kind,exportAsEquipment:true,equipmentTarget:kind,selectedPieces:[]};
 const frames=Array.from({length:4},(_,frame)=>panels(images.length,frame)),exp=await api.buildOutput(cfg,frames.map(q=>obj(q,images.length)),'');await api.saveSingleOutput(exp,api.buildDisplayTransforms(cfg),cfg);
 const prefix=`/rp/assets/minecraft/textures/entity/equipment/${kind}/${cfg.cmdName}_${kind}_`,layers=[...memory.writes].filter(([file])=>file.startsWith(prefix)&&file.endsWith('.png')).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([filename,data])=>({filename,png:Buffer.from(data),...PNG.sync.read(Buffer.from(data))}));if(layers.length!==Math.ceil(frames[0].length/6))throw Error('Unexpected equipment layers');
 for(const[file,data]of memory.writes)if(file.startsWith('/rp/')){const target=path.join(livePack,file.slice(4));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
 return{frames,layers};
}
const transform=(matrix,p)=>[0,1,2].map(k=>matrix[k]*p[0]+matrix[4+k]*p[1]+matrix[8+k]*p[2]+matrix[12+k]);
const draw=(texture,w,h,geometry,count)=>[texture,w,h,geometry,count,1,0];
const cases=[];
for(const scenario of scenarios){const dir=path.join(out,scenario.name);fs.mkdirSync(dir,{recursive:true});const images=scenario.frames.map((count,i)=>image(count,i));for(let i=0;i<images.length;i++)fs.writeFileSync(path.join(dir,`source-${i}.png`),PNG.sync.write(images[i]));
 for(const kind of ['horse_body','horse_saddle']){const model=await exported(scenario,kind,images),pose=poses.find(p=>p.kind===kind&&p.pose==='rest'),carrier=path.join(dir,kind+'-carrier.f32');floats(carrier,pose.vertices);const actual=[];for(let layer=0;layer<model.layers.length;layer++){const im=model.layers[layer],file=path.join(dir,kind+'-'+layer+'.rgba');fs.writeFileSync(file,im.data);fs.writeFileSync(path.join(dir,kind+'-'+layer+'.png'),im.png);actual.push(draw(file,im.width,im.height,carrier,pose.vertices.length/8));}
  if(liveOnly)continue;
  for(const time of [0,.5,2,5,6,12,20,120])for(const mode of ['manual0','manual3','autoplay']){const id=`${scenario.name}-${kind}-t${time}-${mode}`,caseDir=path.join(dir,id);fs.mkdirSync(caseDir,{recursive:true});const expected=[],selectedFrames=[];
   const referenceTextures=images.map((im,i)=>{const frame=Math.floor(time/2)%im.frames,next=(frame+1)%im.frames,mix=scenario.fade?(time%2)/2:0,data=Buffer.alloc(32*32*4);for(let p=0;p<data.length;p++)data[p]=Math.round(im.data[frame*data.length+p]*(1-mix)+im.data[next*data.length+p]*mix);const file=path.join(caseDir,`expected-material-${i}.rgba`);fs.writeFileSync(file,data);selectedFrames.push({material:i,frame,next,mix});return file;});
   const clock=mode==='autoplay'?time:mode==='manual3'?3:0,frame=Math.floor(clock)%4,next=(frame+1)%4,blend=clock-Math.floor(clock);
   for(let face=0;face<model.frames[0].length;face++){const vertices=[];for(let c=0;c<4;c++){const p=model.frames[frame][face][c].map((v,k)=>v*(1-blend)+model.frames[next][face][c][k]*blend),position=transform(pose.bodyMatrix,[p[0],-p[1],p[2]]);vertices.push(...position,uv[c][0],scenario.flip?uv[c][1]:1-uv[c][1],0,0,1);}const file=path.join(caseDir,`reference-face-${face}.f32`);floats(file,vertices);expected.push(draw(referenceTextures[face%images.length],32,32,file,4));}
   cases.push({id,directory:caseDir,time,rgb:mode==='autoplay'?[255,255,255]:[128,0,mode==='manual3'?3:0],expectedEmpty:false,actual,expected,selectedFrames,geometry:{mode,frame,next,blend},scenario:scenario.name,kind});
  }
 }
}
fs.writeFileSync(path.join(out,'cases.matrix.tsv'),cases.map(c=>[c.id,c.time,c.rgb.join(','),false,c.actual.map(d=>d.join(';')).join('|'),c.expected.map(d=>d.join(';')).join('|'),c.directory].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),pluginSHA256:crypto.createHash('sha256').update(fs.readFileSync('objcubed.js')).digest('hex'),sourceHashes,method:'CPU generation only. Actual horse buildOutput/saveSingleOutput atlas exports versus original un-atlased RGBA frame sampling and source OBJ transformed by native body matrix. Four geometry frames, independent texture clock, 2/3/4/5-frame strips, static neighbor, Flip UV and fade. GPU execution must be separately recorded.',scenarios,cases},null,2));console.log(`Prepared ${cases.length} CPU-only horse atlas cases at ${out}`);
