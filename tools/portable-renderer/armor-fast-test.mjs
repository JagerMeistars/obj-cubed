// Prepare a parity shader comparing the optimized face decoder with the actual
// original armor branch. The reference is extracted, never reimplemented.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const require=createRequire(import.meta.url);
const ref=require('../../test/helpers/armor-ref-decode.cjs');
const out=path.resolve(process.argv[2]||'work/armor-fast-validation');
fs.mkdirSync(out,{recursive:true});
const include=path.join(repo,'objcubed/assets/minecraft/shaders/include');
const main=fs.readFileSync(path.join(include,'objmc_main.glsl'),'utf8');
const start=main.indexOf('\n#ifdef ENTITY\nif (isCustom == 0)');
const end=main.indexOf('\n//debug',start);
if(start<0||end<0) throw new Error('Original armor branch boundary changed');
let tools=fs.readFileSync(path.join(include,'objmc_tools.glsl'),'utf8');
tools=tools.replace(/\/\/ Minecraft 26\.3[\s\S]*?#include <minecraft:objmc_carrier.glsl>/,`#define OBJMC_VERTEX_ID oc_virtual_id
void oc_read_carrier(vec3 p,vec2 uv,out vec3 positions[4],out vec2 uvs[4]) {
 for(int i=0;i<4;i++){positions[i]=oc_carrier_positions[i];uvs[i]=oc_carrier_uvs[i];}
}`);
const preamble=`#version 330 core
#define ENTITY
uniform sampler2D Sampler0;
uniform mat4 ProjMat;
uniform float GameTime;
uniform vec3 oc_carrier_positions[4];uniform vec2 oc_carrier_uvs[4];
uniform vec4 oc_control_color;uniform vec3 oc_source_normal;
int oc_virtual_id;
vec3 Pos;vec2 texCoord,texCoord2;float transition;vec4 overlayColor;
int isCustom,isGUI,isHand,noshadow;
vec4 vertexColor,vertexPerFaceColorFront,vertexPerFaceColorBack;
vec3 Light0_Direction=vec3(.2,.7,.4),Light1_Direction=vec3(-.4,.5,-.3);
vec2 minecraft_compute_light(vec3 a,vec3 b,vec3 n){return vec2(dot(a,n),dot(b,n));}
vec4 minecraft_mix_light_separate(vec2 l,vec4 c){return vec4(c.rgb*min(1.0,(max(l.x,0.0)+max(l.y,0.0))*.6+.4),c.a);}
vec4 minecraft_mix_light(vec3 a,vec3 b,vec3 n,vec4 c){return minecraft_mix_light_separate(minecraft_compute_light(a,b,n),c);}
struct OcDecodedVertex{vec3 position;vec2 uv;vec2 uv2;float blend;vec4 overlay;int custom;int gui;int hand;int shadow;};
`;
const original=`OcDecodedVertex original(int id){
oc_virtual_id=id;Pos=oc_carrier_positions[id];vec2 UV0=oc_carrier_uvs[id];
vec4 Color=oc_control_color;vec3 Normal=oc_source_normal;
texCoord=UV0;texCoord2=UV0;transition=0.0;overlayColor=vec4(1.0);
isCustom=0;isGUI=0;isHand=0;noshadow=0;
ivec2 atlasSize=textureSize(Sampler0,0);vec2 onepixel=1.0/vec2(atlasSize);ivec4 t[16];vec3 posoffset;
${main.slice(start,end)}
OcDecodedVertex v;v.position=Pos;v.uv=texCoord;v.uv2=texCoord2;v.blend=transition;
v.overlay=overlayColor;v.custom=isCustom;v.gui=isGUI;v.hand=isHand;v.shadow=noshadow;return v;
}`;
// Test as a vertex shader with transform feedback: replace only fragment's
// discard command by a flag. Empty-route behavior is checked against Pos=9999.
const fast=fs.readFileSync(path.join(here,'armor-fast.glsl'),'utf8').replaceAll('discard;','{ oc_discarded=true;return; }');
const finish=`
out vec4 result;
void main(){
 OcDecodedVertex a=original(gl_VertexID);
 vec4 light0=vertexColor,light1=vertexPerFaceColorFront,light2=vertexPerFaceColorBack;
 OcDecodedVertex b[4];oc_decode_armor(b);
 bool hidden=all(equal(a.position,vec3(9999.0)));
 vec3 d=abs(a.position-b[gl_VertexID].position);
 float pe=max(d.x,max(d.y,d.z));
 float ue=max(length(a.uv-b[gl_VertexID].uv),length(a.uv2-b[gl_VertexID].uv2));
 float other=abs(a.blend-b[gl_VertexID].blend)+length(a.overlay-b[gl_VertexID].overlay);
 other+=float(a.custom!=b[gl_VertexID].custom||a.gui!=b[gl_VertexID].gui||a.hand!=b[gl_VertexID].hand||a.shadow!=b[gl_VertexID].shadow);
 #ifdef PER_FACE_LIGHTING
 other+=length(light1-vertexPerFaceColorFront)+length(light2-vertexPerFaceColorBack);
 #else
 other+=length(light0-vertexColor);
 #endif
 if(hidden||oc_discarded){pe=0.0;ue=0.0;other=float(hidden!=oc_discarded);}
 if(!hidden&&(any(isnan(b[gl_VertexID].position))||any(isinf(b[gl_VertexID].position))))pe=1e20;
 result=vec4(pe,ue,other,hidden?1.0:0.0);gl_Position=vec4(0,0,0,1);
}`;
for(const mode of ['', 'NO_CARDINAL_LIGHTING','PER_FACE_LIGHTING']){
 let shader=preamble.replace('#define ENTITY','#define ENTITY\n'+(mode?'#define '+mode:''))+tools+original+'\nbool oc_discarded=false;\n'+fast+finish;
 fs.writeFileSync(path.join(out,`parity-${mode||'cardinal'}.vert`),shader);
}
// Synthetic encoded data exercises geometry animation and independent texture
// animation. Real getpos/getvert/getuv read it in both compared implementations.
const W=64,H=64,rgba=Buffer.alloc(W*H*4);
function pixel(x,y,c){for(let i=0;i<4;i++)rgba[(y*W+x)*4+i]=c[i]||0;}
function stream(row,i,c){pixel(i%W,row+Math.floor(i/W),c);}
pixel(0,0,[12,34,56,253]);pixel(1,0,[0,W,0,16]);pixel(2,0,[0,0,0,0]);pixel(7,0,[16,16,2,0]);
pixel(3,0,[0,0,4,1]);pixel(4,0,[0,0,8,64]);pixel(5,0,[0,3,0,0]);
pixel(4,1,[0,0,3,0]);pixel(5,1,[1,2,0,0]);
pixel(6,1,[0,8,0,0]);pixel(7,1,[4,2,0,0]);pixel(8,1,[0,2,0,0]);pixel(9,1,[2,3,0,0]);
for(const textures of [1,2]) {
 const ah=3+16*textures;
 for(let frame=0;frame<4;frame++)for(let face=0;face<4;face++)for(let c=0;c<4;c++){
  const v=frame*16+face*4+c;
  const p=[(c===0||c===3?.31:-.27)+.12*Math.sin(frame), (c<2?.53:-.31)+.09*frame, .17*Math.cos(frame)+.07*face];
  for(let k=0;k<3;k++){const n=Math.round((p[k]+128)*65536);stream(ah,v*3+k,[n>>16&255,n>>8&255,n&255,255]);}
  const uv=[c<2?.13:.81, (face%2===0?.56:.09)+(c===2||c===3?.12:0)+frame*.005];
  for(let k=0;k<2;k++){const n=Math.round(uv[k]*65535);stream(ah+3,v*2+k,[0,n>>8&255,n&255,255]);}
  stream(ah+5,v*2,[0,0,v,255]);stream(ah+5,v*2+1,[0,0,v,255]);
 }
}
fs.writeFileSync(path.join(out,'texture.rgba'),rgba);
fs.writeFileSync(path.join(out,'size.txt'),`${W} ${H}\n`);
// Geometry cases use the repository's jar-derived ModelPart cube corner table.
const carriers=[];
for(let part=0;part<8;part++)for(let face=0;face<6;face++)for(let shape=0;shape<3;shape++)for(let cyclic=0;cyclic<4;cyclic++){
 const kind=part===1?0:part===0?1:part<=3?2:3;
 const [w,h,d]=kind===0?[8,8,8]:kind===1?[8,12,4]:[4,12,4];
 const mirror=[3,5,7].includes(part),grow=part===4||part===5?.5:1;
 const name=['DOWN','UP','WEST','NORTH','EAST','SOUTH'][face];
 const R=ref.rotAxis([.3,.9,.7],.4+shape*.31);
 const scale=[.9375,1.4,80][shape],reflect=shape===2;
 const q=ref.carrierQuad({W:w,H:h,D:d,grow,unit:scale/16,mirror,face:name,R,T:[3,-7,1]});
 if(reflect)for(const p of q)p[2]=-p[2];
 let normal=ref.mulMV(R,[[0,-1,0],[0,1,0],[-1,0,0],[0,0,-1],[1,0,0],[0,0,1]][face]);
 // Preview reflection leaves vanilla normals unreflected, matching the code.
 const [ox,oy]=kind===0?[0,0]:kind===1?[16,16]:kind===2?[40,16]:[0,16];
 const rect=face===2?[ox,oy+d,ox+d,oy+d+h]:face===3?[ox+d,oy+d,ox+d+w,oy+d+h]:face===4?[ox+d+w,oy+d,ox+2*d+w,oy+d+h]:face===5?[ox+2*d+w,oy+d,ox+2*d+2*w,oy+d+h]:face===1?[ox+d,oy,ox+d+w,oy+d]:[ox+d+w,oy,ox+d+2*w,oy+d];
 let uv=[[rect[2],rect[1]],[rect[0],rect[1]],[rect[0],rect[3]],[rect[2],rect[3]]];
 if(mirror)uv.reverse();
 const record=[part,face,shape,cyclic];
 for(let c=0;c<4;c++)record.push(...q[(c+cyclic)%4]);
 for(let c=0;c<4;c++){const u=uv[(c+cyclic)%4];record.push(u[0]/64,u[1]/32);}
 record.push(...normal);
 carriers.push(...record);
}
fs.writeFileSync(path.join(out,'carriers.f32'),Buffer.from(new Float32Array(carriers).buffer));
console.log(`Prepared ${carriers.length/27} carriers and three original/optimized shader pairs in ${out}`);
