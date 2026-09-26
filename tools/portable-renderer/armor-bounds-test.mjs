// Generate forward-transformed surface points as an independent oracle for the
// production inverse-ray AB1 rejection helper. Does not duplicate its inverse.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
const {PNG}=require('pngjs'),ref=require('../../test/helpers/armor-ref-decode.cjs');
const here=path.dirname(fileURLToPath(import.meta.url));const [file,directory]=process.argv.slice(2);
if(!file||!directory)throw Error('Usage: armor-bounds-test.mjs CONVERTED_ARMOR.png OUT');
const out=path.resolve(directory);fs.mkdirSync(out,{recursive:true});
const png=PNG.sync.read(fs.readFileSync(file)),h=ref.decodeArmorHeader(png);
if(png.data[23*4]!==65||png.data[23*4+1]!==66||png.data[23*4+2]!==49)throw Error('AB1 input required');
fs.writeFileSync(path.join(out,'texture.rgba'),png.data);fs.writeFileSync(path.join(out,'size.txt'),`${png.width} ${png.height}\n`);
const helper=fs.readFileSync(path.join(here,'armor-bounds.glsl'),'utf8');
const vertex='#version 330 core\nvoid main(){vec2 p[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));gl_Position=vec4(p[gl_VertexID],0,1);}\n';
fs.writeFileSync(path.join(out,'bounds.vert'),vertex);
for(let zero=0;zero<2;zero++)fs.writeFileSync(path.join(out,`bounds-${zero}.frag`),`#version 330 core
${zero?'#define RENDERPEARL_DEPTH_IS_ZERO_TO_ONE':''}
uniform sampler2D Sampler0;uniform mat4 ProjMat,ModelViewMat;
uniform int Face;uniform vec3 Anchor,Offset;uniform mat3 Basis;uniform float Scale;uniform int Left;uniform vec2 Screen;
${helper}
out float result;void main(){result=oc_armor_bounds_hit(textureSize(Sampler0,0).x,Face,Anchor,Basis,Scale,Offset,Left!=0,Screen)?1.0:0.0;}
`);
const records=[];const frames=[0,Math.floor(h.nframes/2),h.nframes-1];
const mat4mul=(m,p)=>[0,1,2,3].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*p[3]);
const decode=(face,c,f)=>{let ix=ref.getvert(h.tex,[0,0],h.size[0],h.ah+h.avph+h.avth,face*4+c+f*h.nvertices);return ref.getpos(h.tex,[0,0],h.size[0],h.ah,ix[0]);};
const faceCount=h.nvertices/4;
for(let face=0;face<faceCount;face++)for(let shape=0;shape<4;shape++)for(let zero=0;zero<2;zero++)for(let ortho=0;ortho<2;ortho++) {
 let basis=ref.rotAxis([.4,.7,.3],.2+shape*.61);if(shape&1)basis[2]=ref.scale(basis[2],-1);
 const scale=[.05,1,16,80][shape],left=(shape&2)!==0,offset=ref.AOFF[(face+shape)%8],anchor=[3,-2,-400];
 const mv=[1,0,0,0,0,1,0,0,0,0,1,0,.3,-.4,-.2,1];
 const n=.1,f=10000,proj=new Array(16).fill(0);proj[0]=proj[5]=ortho?.002:1.2;
 if(ortho){proj[10]=(zero?1:2)/(f-n);proj[14]=zero?f/(f-n):(f+n)/(f-n);proj[15]=1;}
 else{proj[10]=zero?n/(f-n):(f+n)/(f-n);proj[14]=(zero?1:2)*f*n/(f-n);proj[11]=-1;}
 for(const frame of frames) {
  const corners=Array.from({length:4},(_,c)=>decode(face,c,frame));
  const points=[...corners,ref.scale(ref.add(ref.add(corners[0],corners[1]),corners[2]),1/3)];
  for(const raw of points) {
   let local=[raw[0],raw[1]+.5,raw[2]];if(left)local[0]=-local[0];
   const world=ref.add(anchor,ref.mulMV(basis,ref.scale(ref.sub(local,offset),scale)));
   const clip=mat4mul(proj,mat4mul(mv,[...world,1]));if(clip[3]<=0)continue;
   const depth=clip[2]/clip[3];if(depth>1||depth<(zero?0:-1))continue;
   const screen=[clip[0]/clip[3],clip[1]/clip[3]];
   records.push(zero,face,...anchor,...basis.flat(),scale,...offset,+left,...screen,...proj,...mv);
  }
 }
}
const stride=53;if(records.length%stride)throw Error('record stride');
fs.writeFileSync(path.join(out,'cases.f32'),Buffer.from(new Float32Array(records).buffer));
console.log(`Prepared ${records.length/stride} actual surface projections from ${faceCount} faces (${h.nframes} frames)`);
