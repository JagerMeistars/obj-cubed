import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
import {exported,floats,uv} from './horse-fixture-library.mjs';
const out=path.resolve(process.argv[2]??'audit/2026-09-29/horse-equipment-matrix');fs.mkdirSync(out,{recursive:true});
const source=path.resolve('objcubed'),sourceHashes={};
for(const[ext,stage]of[['vsh','vert'],['fsh','frag']]){let text=expandShader(path.join(source,'assets/minecraft/shaders/core/entity.'+ext),[source,path.resolve('audit/2026-09-28/vanilla')]).replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');fs.writeFileSync(path.join(out,'entity.'+stage),text);sourceHashes[ext]=crypto.createHash('sha256').update(text).digest('hex');}
const poses=JSON.parse(fs.readFileSync('audit/2026-09-29/animal-equipment/native-poses.json','utf8')).poses;
const prepared=new Map(),cases=[];
async function prepare(name,kind,options={}){const key=[name,kind,JSON.stringify(options)].join('-');if(!prepared.has(key))prepared.set(key,await exported(name,kind,options));return prepared.get(key);}
const transform=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]);
function brightness(q,frontFacing=true){const a=q[1].map((v,k)=>v-q[0][k]),b=q[2].map((v,k)=>v-q[0][k]);let n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...n);n=n.map(v=>v/length);if(frontFacing&&n.reduce((s,v,k)=>s+v*([0,0,3][k]-q[0][k]),0)<0)n=n.map(v=>-v);return Math.min(1,.4+.6*(Math.max(0,-n[1])+Math.max(0,-n[2])));}
function animated(frames,clock,easing=0){const at=Math.floor(clock)%frames.length;let t=clock-Math.floor(clock);if(!easing)return frames[at];if(easing===2)t=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;return frames[at].map((q,f)=>q.map((p,c)=>p.map((v,k)=>{const p0=v,p1=frames[(at+1)%frames.length][f][c][k];if(easing!==3)return p0*(1-t)+p1*t;const p2=frames[(at+2)%frames.length][f][c][k],p3=frames[(at+3)%frames.length][f][c][k];return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);})));}
function draw(file,w,h,geometry,count,shade=1,base=0){return[file,w,h,geometry,count,shade,base];}
async function add(id,poseNames,names,options={}){const dir=path.join(out,id);fs.mkdirSync(dir,{recursive:true});const actual=[],expected=[];for(let k=0;k<poseNames.length;k++){
 const pose=poseNames[k],model=await prepare(names[k],pose.kind,options),frame=options.frame??0,time=options.time??0,texframe=Math.floor(time/2)%(options.textureFrames??1),sourceTex=path.join(dir,`source-${k}.rgba`),sourcePixels=Buffer.from(model.source.data.subarray(texframe*32*32*4,(texframe+1)*32*32*4));if(options.fade){const next=(texframe+1)%(options.textureFrames??1),blend=(time%2)/2;for(let i=0;i<sourcePixels.length;i++)sourcePixels[i]=Math.round(sourcePixels[i]*(1-blend)+model.source.data[next*32*32*4+i]*blend);}fs.writeFileSync(sourceTex,sourcePixels);
 const sourceMesh=animated(model.frames,options.clock??frame,options.easing??0);
 const carrier=path.join(dir,`native-${k}.f32`);let vertices=pose.vertices.slice();
 if(options.cycle)for(let at=0;at<vertices.length;at+=32){const q=vertices.slice(at,at+32);vertices.splice(at,32,...q.slice(8),...q.slice(0,8));}
 floats(carrier,vertices);
 if(options.vanilla){actual.push(draw(sourceTex,32,32,carrier,vertices.length/8));for(let f=0;f<vertices.length/32;f++){let v=vertices.slice(f*32,f*32+32),n=v.slice(5,8),shade=Math.min(1,.4+.6*(Math.max(0,-n[1])+Math.max(0,-n[2]))),file=path.join(dir,`plain-${k}-${f}.f32`);floats(file,v);expected.push(draw(sourceTex,32,32,file,4,shade));}continue;}
 for(let layer=0;layer<model.layers.length;layer++){const im=model.layers[layer],data=Buffer.from(im.data),file=path.join(dir,`layer-${k}-${layer}.rgba`);
  if(options.invalid==='version')data[8*4+3]=2;if(options.invalid==='kind')data[9*4+3]=2;
  if(options.invalid==='empty'||options.invalid==='index')for(let f=0;f<6;f++){data[(8+f)*4]=options.invalid==='empty'?255:0;data[(8+f)*4+1]=options.invalid==='empty'?255:250;}
  fs.writeFileSync(file,data);actual.push(draw(file,im.width,im.height,carrier,vertices.length/8,1,options.base??0));
  if(options.invalid)continue;
  for(let f=layer*6;f<Math.min(sourceMesh.length,layer*6+6);f++){const q=sourceMesh[f].map(p=>transform(pose.bodyMatrix,[p[0],-p[1],p[2]])),v=[],emis=typeof options.emission==='function'?options.emission(f):options.emission??0,shade=options.noshadow===false&&emis===0?brightness(q):1;for(let c=0;c<4;c++)v.push(...q[c],uv[c][0],1-uv[c][1],0,0,1);const rfile=path.join(dir,`reference-${k}-${f}.f32`);floats(rfile,v);expected.push(draw(sourceTex,32,32,rfile,4,shade));}
 }
 }
 cases.push({id,directory:dir,time:options.time??0,rgb:options.rgb??[255,255,255],expectedEmpty:!!options.invalid,actual,expected});
}
for(const pose of poses){await add(`${pose.kind}-${pose.pose}-panels`,[pose],['panels']);await add(`${pose.kind}-${pose.pose}-decor`,[pose],['horse_decor']);}
for(const kind of ['horse_body','horse_saddle']){const rest=poses.find(p=>p.kind===kind&&p.pose==='rest');
 await add(kind+'-sparse',[rest],['sparse']);await add(kind+'-cycled-offset',[rest],['panels'],{cycle:true,base:12});
 await add(kind+'-emission-local',[rest],['panels'],{noshadow:false,emission:f=>f%2?15:0});
 await add(kind+'-lit',[rest],['horse_decor'],{noshadow:false});
 for(const invalid of ['version','kind','empty','index'])await add(kind+'-invalid-'+invalid,[rest],['panels'],{invalid});
 await add(kind+'-plain-vanilla',[rest],['panels'],{vanilla:true});
 for(const time of [0,1,2,5,6])for(const frame of [0,3])await add(`${kind}-animation-t${time}-f${frame}`,[rest],['horse_anim'],{frames:4,textureFrames:3,time,frame,rgb:[128,0,frame]});
 await add(kind+'-manual-overflow',[rest],['horse_anim'],{frames:4,textureFrames:3,time:2,frame:3,rgb:[128,0,9]});
 for(const easing of [0,1,2,3])for(const time of [0,.5,1.25,3.5,4,6.75])await add(`${kind}-auto-e${easing}-t${time}`,[rest],['horse_anim'],{frames:4,textureFrames:3,easing,autoplay:true,time,clock:time,fade:true});
 await add(kind+'-loop-offset',[rest],['horse_anim'],{frames:4,textureFrames:3,easing:1,time:2.5,clock:5.5,rgb:[0,0,1]});
 await add(kind+'-once-middle',[rest],['horse_anim'],{frames:4,textureFrames:3,easing:1,time:3.5,clock:2.5,rgb:[0,128,1]});
 await add(kind+'-once-final',[rest],['horse_anim'],{frames:4,textureFrames:3,easing:1,time:20,clock:3,rgb:[0,128,1]});
}
for(const poseName of ['rest','rear','rotated'])await add('together-'+poseName,poses.filter(p=>p.pose===poseName),['horse_decor','horse_decor']);
fs.writeFileSync(path.join(out,'cases.matrix.tsv'),cases.map(c=>[c.id,c.time,c.rgb.join(','),c.expectedEmpty,c.actual.map(d=>d.join(';')).join('|'),c.expected.map(d=>d.join(';')).join('|'),c.directory].join('\t')).join('\n'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),pluginSHA256:crypto.createHash('sha256').update(fs.readFileSync('objcubed.js')).digest('hex'),sourceHashes,method:'Actual native 26.3 setupAnim full model carriers. Independent source OBJ transformed by captured body matrix, source RGBA frame sampling and mathematical native-light formula. Actual buildOutput/saveSingleOutput. No shader decoder/reference-source parity. Synthetic hidden GL, not Minecraft gameplay.',cases},null,2));console.log('Prepared '+cases.length+' cases');
