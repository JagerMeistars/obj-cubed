// Prepare a real-rasterizer comparison of generic and AS1 position-only carrier
// reconstruction, including sparse weights that vanish on triangle edges.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),out=path.resolve(process.argv[2]);
fs.mkdirSync(out,{recursive:true});
const carrier=fs.readFileSync(path.join(here,'carrier.glsl'),'utf8');
const affine=fs.readFileSync(path.join(here,'armor-affine.glsl'),'utf8');
const rect=affine.slice(affine.indexOf('vec4 oc_armor_as1_rect('),affine.indexOf('vec3 oc_armor_as1_offset('));
const transfer=affine.slice(affine.indexOf('// AS1 position-only carrier.'),affine.indexOf('bool oc_apply_armor_as1('));
const vary=direction=>['oc_p0','oc_p1','oc_p2','oc_p3','oc_uv01','oc_uv23','oc_high01','oc_high12','oc_high23']
 .map(name=>`${direction} vec4 ${name};`).join('\n');
fs.writeFileSync(path.join(out,'transfer.vert'),`#version 330 core
#define OC_PORTABLE_VERTEX
#define OC_PORTABLE_PRECISE
${carrier}
${rect}
uniform int flags;
layout(location=0) in vec3 position;layout(location=1) in vec2 UV;
${vary('out')}
void main(){
 vec4 rect=oc_armor_as1_rect(flags);
 vec2 q=(UV-rect.xy)/(rect.zw-rect.xy);
 int corner=q.y<.5?(q.x>.5?0:1):(q.x>.5?3:2);
 oc_portable_encode(corner,position,UV,oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23);
 int part=flags&7;bool left=part==3||part==5||part==7;
 gl_Position=vec4(vec2(left?q.x:1-q.x,q.y)*2-1,0,1);
}`);
fs.writeFileSync(path.join(out,'transfer.frag'),`#version 330 core
#define OC_PORTABLE_PRECISE
${vary('in')}
uniform int flags;
vec2 oc_carrier_uvs[4];
${carrier}
${rect}
${transfer}
out vec4 result;
void main(){
 vec3 ordinary[4],fast[4];vec2 uv[4];
 bool a=oc_portable_decode(oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23,ordinary,uv);
 bool b=oc_decode_armor_as1_carrier(fast);oc_armor_as1_carrier_uvs(flags);
 float positionError=0.0,uvError=0.0;
 for(int i=0;i<4;i++){
  positionError=max(positionError,max(abs(ordinary[i].x-fast[i].x),max(abs(ordinary[i].y-fast[i].y),abs(ordinary[i].z-fast[i].z))));
  uvError=max(uvError,length(round(uv[i])/vec2(64,32)-oc_carrier_uvs[i]));
 }
 result=vec4(positionError,uvError,float(a!=b),float(!a||!b));
}`);
console.log(out);
