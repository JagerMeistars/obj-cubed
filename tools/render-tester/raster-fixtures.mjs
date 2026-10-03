// CPU preparation for WindowsRasterCheck.java. Uses the real exporter, but
// constructs reference triangles independently from the source OBJ coordinates.
// Usage: node tools/render-tester/raster-fixtures.mjs <output> <vanilla-assets-root>
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../../test/helpers/load-plugin.cjs');
const output=path.resolve(process.argv[2]??'audit/raster'),vanilla=path.resolve(process.argv[3]??'audit/2026-09-28/vanilla');
fs.mkdirSync(output,{recursive:true});
const width=32,height=32,rgba=new Uint8Array(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const i=4*(y*width+x);rgba.set([32+x*6,32+y*6,((x>>2)+(y>>2))%2?220:45,255],i);
}
class Image {set src(_){queueMicrotask(()=>this.onload?.());}get naturalWidth(){return width;}get naturalHeight(){return height;}}
const {api}=loadObjcubedWithContext({globals:{Buffer,Image,setTimeout,process,
 console:{log(){},warn(){},error:console.error},
 document:{createElement(){return {getContext(){return {drawImage(){},getImageData(){return {data:rgba,width,height};}};}};}},
 Texture:{all:[{uuid:'u',name:'raster',source:'data:fixture',img:{src:'data:fixture'}}]},Outliner:{root:[]}}});
const uv=[[.125,.125],[.875,.125],[.875,.875],[.125,.875]];
const cube=[[-.42,.1,-.3],[.42,.1,-.3],[-.42,.9,-.3],[.42,.9,-.3],[-.42,.1,.3],[.42,.1,.3],[-.42,.9,.3],[.42,.9,.3]];
const faces=[[1,0,2,3],[4,5,7,6],[0,4,6,2],[5,1,3,7],[3,2,6,7],[4,0,1,5]].map(f=>f.map(i=>cube[i]));
// Five separated, slanted fins expose dropped or wrongly grouped carrier quads.
for(let j=0;j<5;j++){const x=-.9+j*.4;faces.push([[x,.98,-.15],[x+.19,.98,-.05],[x+.16,1.2,.03],[x-.05,1.15,-.1]]);}
const frames=[faces,faces.map((f,i)=>f.map(([x,y,z])=>[x+(i>=6?.07:0),y*(i>=6?1.1:1),z+(i>=6?.08:0)]))];
function obj(mesh){const lines=['usemtl m_u',...uv.map(v=>'vt '+v.join(' '))];let n=1;for(const f of mesh){for(const p of f)lines.push('v '+p.join(' '));lines.push('f '+f.map((_,k)=>(n+k)+'/'+(k+1)).join(' '));n+=4;}return lines.join('\n');}
function rot(v,r){const [x,y,z]=r.map(t=>t*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);let [a,b,c]=v;[a,b]=[a*cz-b*sz,a*sz+b*cz];[a,c]=[a*cy+c*sy,-a*sy+c*cy];return [a,b*cx-c*sx,b*sx+c*cx];}
function transform(v,scale,rotation,translation){return rot(v.map((a,i)=>a*scale[i]),rotation).map((a,i)=>a+translation[i]);}
function writeFloats(file,values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(file,b);}
for(const stage of ['vsh','fsh']){
 let src=expandShader(path.resolve('objcubed/assets/minecraft/shaders/core/item.'+stage),[path.resolve('objcubed'),vanilla]);
 src=src.replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n');
 fs.writeFileSync(path.join(output,'shader.'+(stage==='vsh'?'vert':'frag')),src);
}
const cases=[
 {name:'identity',s:[1,1,1],r:[0,0,0]},
 {name:'pose_xyz',s:[.8,.8,.8],r:[23,-47,19]},
 {name:'nonuniform_xyz',s:[.7,1.2,.45],r:[-31,38,12]},
 {name:'hand_context',s:[.8,1.1,.65],r:[16,55,-25],slot:'firstperson_righthand'},
 {name:'linear_animation_half',s:[1,1,1],r:[9,-29,6],time:.5,animation:true},
 {name:'arena_offset1',s:[1,1,1],r:[18,31,7],base:1},
 {name:'arena_offset2',s:[1,1,1],r:[-15,-24,-8],base:2},
 {name:'arena_offset3',s:[1,1,1],r:[17,50,12],base:3},
 {name:'arena_offset4',s:[1,1,1],r:[18,31,7],base:4},
 {name:'arena_offset28',s:[1,1,1],r:[-15,-24,-8],base:28},
 {name:'arena_offset32',s:[1,1,1],r:[17,50,12],base:32},
];
const manifest=[];
for(const c of cases){
 const dir=path.join(output,c.name);fs.mkdirSync(dir,{recursive:true});const slot=c.slot??'fixed',t=[.07,-.08,.04];
 const displaySlots={[slot]:{rotation:c.r,scale:c.s,translation:t.map(a=>a*16)}};
 const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:2,autoplay:!!c.animation,easing:c.animation?1:0,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots,flipuv:false,useAtlas:false,texAnimEnabled:false,texFrametime:1,texFade:false};
 const exp=await api.buildOutput(cfg,(c.animation?frames:[frames[0]]).map(obj),'');
 const elements=api.calibratedElementsForSlot(exp.elements,slot,api.assignSlotMarkers(displaySlots).ids.get(slot)||0);
 fs.writeFileSync(path.join(dir,'export.png'),exp.pngBuffer);fs.writeFileSync(path.join(dir,'export.json'),api.buildSlotModelJson('raster',slot,displaySlots,elements));
 fs.writeFileSync(path.join(dir,'texture.rgba'),exp.rawBuf);
 const refTexture=new Uint8Array(rgba.length);for(let y=0;y<height;y++)refTexture.set(rgba.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);fs.writeFileSync(path.join(dir,'reference.rgba'),refTexture);
 const carrier=[],reference=[];
 for(const e of elements){const [x0,y0,z0]=e.from,[x1,y1]=e.to;const u=e.faces.north.uv;
  const coords=[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]],tex=[[u[0],u[1]],[u[0],u[3]],[u[2],u[3]],[u[2],u[1]]];
  for(let k=0;k<4;k++)carrier.push(...transform(coords[k].map(a=>a/16-.5),c.s,c.r,t),...tex[k].map(a=>a/16));
 }
 const mesh=c.animation?frames[0].map((f,i)=>f.map((p,j)=>p.map((v,a)=>(v+frames[1][i][j][a])*.5))):frames[0];
 for(const f of mesh)for(let k=0;k<4;k++)reference.push(...transform([f[k][0],f[k][1]-.5,f[k][2]],c.s,c.r,t),...uv[k]);
 writeFloats(path.join(dir,'carrier.f32'),carrier);writeFloats(path.join(dir,'reference.f32'),reference);
 fs.writeFileSync(path.join(dir,'meta.txt'),[exp.tw,exp.ty,width,height,carrier.length/5,c.base??0,c.time??0].join(' '));
 fs.writeFileSync(path.join(dir,'source.obj'),obj(frames[0]));manifest.push({name:c.name,...c,faces:faces.length,slot,directory:dir});
}
fs.writeFileSync(path.join(output,'cases.txt'),manifest.map(c=>c.directory).join('\n'));fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Prepared ${manifest.length} independently referenced raster cases in ${output}`);
