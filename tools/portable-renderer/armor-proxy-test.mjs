// Raster coverage of the exact AS1 UV-rectangle/proxy transport expressions.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(process.argv[2]||'work/armor-proxy-validation');
const fixtures=path.resolve(process.argv[3]||'work/armor-affine-validation');
fs.mkdirSync(out,{recursive:true});
const read=n=>fs.readFileSync(path.join(here,n),'utf8');
const affine=read('armor-affine.glsl'),vertex=read('vertex.glsl'),fragment=read('fragment.glsl'),carrier=read('carrier.glsl');
const rect=affine.slice(affine.indexOf('vec4 oc_armor_as1_rect'),affine.indexOf('\nvec3 oc_armor_as1_offset'));
const proxy=vertex.slice(vertex.indexOf('        vec4 rect=oc_armor_as1_rect(flags);'),vertex.indexOf('\n    }\n#endif\n    oc_portable_encode'));
if(!proxy.includes('as1Screen='))throw Error('AS1 proxy region changed');
let screen=fragment.slice(fragment.indexOf('    vec2 screenPoint=vec2('),fragment.indexOf('\n    vec2 screenDx='));
if(!screen.includes('screenPoint.x=-screenPoint.x'))throw Error('AS1 fragment region changed');
const varying=direction=>['p0','p1','p2','p3','uv01','uv23','high01','high12','high23'].map(n=>`noperspective ${direction} vec4 oc_${n};`).join('\n');
const vs=`#version 330 core
#define OC_PORTABLE_VERTEX
#define OC_PORTABLE_PRECISE
uniform vec3 input_positions[4];uniform vec2 input_uvs[4];
uniform int flags,baseVertex;
${varying('out')}
${carrier}
${rect}
void main(){
 int index=gl_VertexID-baseVertex;
 vec3 sourcePosition=input_positions[index];
 vec2 localUV=input_uvs[index]*vec2(64.0,32.0);
 int vid=gl_VertexID;vec2 as1Screen=vec2(0.0);
${proxy}
 oc_portable_encode(vid,sourcePosition,localUV,oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23);
 gl_Position=vec4(as1Screen,.5,1.0);
}`;
const fsHeader=`#version 330 core
#define OC_PORTABLE_PRECISE
uniform vec3 expected_positions[4];uniform int flags;uniform vec2 viewport;
${varying('in')}
out vec4 result;
${carrier}
void main(){
 vec3 positions[4];vec2 uv[4];
 bool valid=oc_portable_decode(oc_p0,oc_p1,oc_p2,oc_p3,oc_uv01,oc_uv23,oc_high01,oc_high12,oc_high23,positions,uv);
 int mode=4;vec4 oc_parameters=vec4(0,0,float(flags),4);
`;
const fsTail=`
 vec2 actual=gl_FragCoord.xy/viewport*2.0-1.0;
 float error=length(actual-screenPoint);
 for(int i=0;i<4;i++)error=max(error,length(positions[i]-expected_positions[i]));
 result=vec4(valid&&error<.00005?0.0:1.0,1.0,gl_FrontFacing?1.0:0.0,1.0);
}`;
fs.writeFileSync(path.join(out,'proxy.vert'),vs);
const early=vs.replace(' oc_portable_encode(vid,sourcePosition,localUV,', ' if(any(lessThan(localUV,rect.xy))||any(greaterThan(localUV,rect.zw))){gl_Position=vec4(as1Screen,.5,1.0);return;}\n oc_portable_encode(vid,sourcePosition,localUV,');
fs.writeFileSync(path.join(out,'early.vert'),early);
fs.writeFileSync(path.join(out,'proxy.frag'),fsHeader+screen+fsTail);
fs.writeFileSync(path.join(out,'negative.frag'),fsHeader+screen.replace('screenPoint.x=-screenPoint.x','screenPoint.x=screenPoint.x')+fsTail);
fs.copyFileSync(path.join(fixtures,'carriers.f32'),path.join(out,'carriers.f32'));
const hash=x=>createHash('sha256').update(x).digest('hex');
fs.writeFileSync(path.join(out,'source-sha256.json'),JSON.stringify({affine:hash(affine),vertex:hash(vertex),fragment:hash(fragment),carrier:hash(carrier)},null,2));
console.log(out);
