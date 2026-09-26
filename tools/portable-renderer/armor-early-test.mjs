// Prepare the actual early-rejection GLSL for a small private GL3.3 test.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const carrier=fs.readFileSync(path.join(here,'carrier.glsl'),'utf8');
const tools=fs.readFileSync(path.join(root,'objcubed/assets/minecraft/shaders/include/objmc_tools.glsl'),'utf8');
const face=tools.slice(tools.indexOf('ivec2 oc_armor_uvface('));
const early=fs.readFileSync(path.join(here,'armor-early.glsl'),'utf8');
fs.writeFileSync(path.join(out,'early.vert'),`#version 330 core
#define OC_PORTABLE_VERTEX
${carrier}
layout(location=0) in vec2 UV;
out vec4 p[4],u[2];
void main(){oc_portable_encode(gl_VertexID,vec3(0),UV,p,u);gl_Position=vec4(oc_portable_screen_corner(gl_VertexID)*2.0-1.0,0,1);}
`);
fs.writeFileSync(path.join(out,'early.frag'),`#version 330 core
#define ENTITY
uniform sampler2D Sampler0;
ivec4 getmeta(ivec2 origin,int i){return ivec4(texelFetch(Sampler0,origin+ivec2(i,0),0)*255.0+0.5);}
${face}
${early}
in vec4 p[4],u[2];out float result;
void main(){result=oc_armor_carrier_used(vec4(p[0].w,p[1].w,p[2].w,p[3].w),u[0],u[1])?1.0:0.0;}
`);
console.log(out);
