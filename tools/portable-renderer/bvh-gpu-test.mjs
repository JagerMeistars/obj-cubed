// Prepare the current, unmodified GLSL tracer for bvh-gpu-test.c.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),negative=args.includes('--negative-control');
if(negative)args.splice(args.indexOf('--negative-control'),1);
const [input,directory]=args;
if(!input||!directory)throw Error('Usage: node tools/portable-renderer/bvh-gpu-test.mjs CONVERTED_ITEM.png OUTPUT_DIR');
const png=PNG.sync.read(fs.readFileSync(input));
if(png.data[76]!==66||png.data[77]!==86||png.data[78]!==72)throw Error('Input lacks BVH header magic');
fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'texture.rgba'),png.data);
fs.writeFileSync(path.join(directory,'size.txt'),`${png.width} ${png.height}\n`);
const source=fs.readFileSync(path.resolve(here,'../../objcubed/assets/minecraft/shaders/include/objmc_tools.glsl'),'utf8');
function extract(name){
  const pattern=new RegExp('(?:ivec[234]|vec[234]|float|bool) '+name+'\\('), match=pattern.exec(source);
  if(!match)throw Error(`Missing decoder function ${name}`);
  const start=match.index, body=source.indexOf('{',start);let nesting=1,end=body+1;
  for(;nesting;end++){if(source[end]==='{')nesting++;if(source[end]==='}')nesting--;if(end>=source.length)throw Error('Unclosed GLSL function');}
  return source.slice(start,end)+'\n';
}
const functions=['getmeta','getpos','getvert','bezb','bezier'].map(extract).join('\n');
const originalTracer=fs.readFileSync(path.join(here,'bvh.glsl'),'utf8');
const tracer=negative?originalTracer.replace('node=skip;continue;','node=count;continue;'):originalTracer;
if(negative&&tracer===originalTracer)throw Error('Negative-control substitution did not match');
const affine=fs.readFileSync(path.join(here,'item-affine.glsl'),'utf8');
const preamble=`#version 330 core
uniform sampler2D Sampler0;
uniform mat4 ProjMat,ModelViewMat;
uniform mat3 PoseTransform;
uniform vec3 PoseAnchor,PoseLift;
uniform vec4 oc_decoded0,oc_decoded1,oc_decoded2,oc_decoded_uv01;
uniform vec2 Resolution;
out vec4 result;
`;
const main=`
void main(){
  OcItemAffine pose;pose.transform=PoseTransform;pose.anchor=PoseAnchor;pose.lift=PoseLift;
  pose.visible=true;pose.gui=0;pose.hand=0;
  int face=oc_bvh_trace(pose,ivec2(0,2),gl_FragCoord.xy/Resolution*2.0-1.0);
  result=vec4(float(face+1),0,0,1);
}
`;
for(const zero of[0,1])fs.writeFileSync(path.join(directory,`trace${zero}.frag`),preamble+(zero?'#define RENDERPEARL_DEPTH_IS_ZERO_TO_ONE\n':'')+functions+affine+tracer+main);
fs.writeFileSync(path.join(directory,'fullscreen.vert'),`#version 330 core
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}\n`);
const sha=text=>createHash('sha256').update(text).digest('hex');
fs.writeFileSync(path.join(directory,'inputs.json'),JSON.stringify({input,negativeControl:negative,tracerSha256:sha(originalTracer),affineSha256:sha(affine),decoderSha256:sha(source)},null,2)+'\n');
console.log(`Prepared current bvh.glsl, actual decoder and affine functions, ${png.width}x${png.height} image`);
