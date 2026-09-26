// Compile the actual AS2 tracer, selected-quad decoder and AS1 wearer pose for
// comparison with independently forward-transformed CPU triangles.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {readEncodedGeometryInfo,decodePositions,faceBounds,buildNodes,buildSegmentBounds} from './build-bvh.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const [input,directory,option]=process.argv.slice(2);
const negative=option==='--negative-left-diagonal';
if(option&&!negative)throw Error('Unknown test option');
if(!input||!directory)throw Error('Usage: node tools/portable-renderer/armor-bvh-test.mjs AS2.png OUTPUT_DIR');
function nonplanarFixture(){
 const W=32,F=4,V=8,pr=19,ph=3,uh=2,ir=24,treeRow=26,segmentRow=27;
 const png=new PNG({width:W,height:32});
 const texel=(x,y,value)=>png.data.set(value,(y*W+x)*4);
 const put=(index,n)=>png.data.set([n>>>16&255,n>>>8&255,n&255,255],index*4);
 texel(0,0,[12,34,56,253]);texel(1,0,[0,W,0,0]);texel(2,0,[0,0,0,0]);
 texel(3,0,[0,0,F,1]);texel(4,0,[0,0,F,64]);texel(5,0,[0,ph,0,0]);texel(7,0,[16,V,uh,0]);
 texel(8,0,[0,0,3,1]);texel(26,0,[65,83,50,255]);texel(27,0,[3,3,0,255]);
 for(let y=3;y<19;y++)for(let x=0;x<W;x++)texel(x,y,[255,255,255,255]);
 const corners=[[-.4,0,0],[.4,0,0],[.4,.8,0],[-.4,.8,0]];
 for(let frame=0;frame<F;frame++)for(let face=0;face<2;face++)for(let corner=0;corner<4;corner++){
  const i=frame*V+face*4+corner,p=[...corners[corner]];
  p[2]=face===1?.08:corner===2?.35+.1*Math.sin(frame):0;
  for(let a=0;a<3;a++)put(pr*W+i*3+a,Math.round((p[a]+128)*65536));
  for(let a=0;a<2;a++)put((pr+ph)*W+i*2+a,Math.round((a===0?(corner===1||corner===2?.8:.2):(corner>=2?.8:.2))*65535));
  put(ir*W+i*2,i);put(ir*W+i*2+1,i);
 }
 const info=readEncodedGeometryInfo(png,253),positions=decodePositions(png,info);
 const {nodes}=buildNodes(faceBounds(positions,info));
 const segments=buildSegmentBounds(positions,info,nodes);
 put(28,treeRow);put(29,nodes.length);put(30,segmentRow);texel(31,0,[65,66,50,255]);
 for(let i=0;i<nodes.length;i++){
  const node=nodes[i],at=treeRow*W+i*8;
  for(let a=0;a<3;a++){put(at+a,Math.round((node.min[a]+256)*32768));put(at+3+a,Math.round((node.max[a]+256)*32768));}
  put(at+6,node.skip);put(at+7,node.face);
 }
 segments.copy(png.data,segmentRow*W*4);
 return png;
}
const png=input==='--synthetic'?nonplanarFixture():PNG.sync.read(fs.readFileSync(input));
if(png.data[104]!==65||png.data[105]!==83||png.data[106]!==50)throw Error('Input lacks AS2 magic');
fs.mkdirSync(directory,{recursive:true});
if(input==='--synthetic')fs.writeFileSync(path.join(directory,'synthetic-nonplanar.png'),PNG.sync.write(png));
fs.writeFileSync(path.join(directory,'texture.rgba'),png.data);
fs.writeFileSync(path.join(directory,'size.txt'),`${png.width} ${png.height}\n`);
let tools=fs.readFileSync(path.resolve(here,'../../objcubed/assets/minecraft/shaders/include/objmc_tools.glsl'),'utf8');
tools=tools.replace(/\/\/ Minecraft 26\.3[\s\S]*?#include <minecraft:objmc_carrier.glsl>/,'');
const armor=fs.readFileSync(path.join(here,'armor-affine.glsl'),'utf8');
const bvh=fs.readFileSync(path.join(here,'bvh.glsl'),'utf8');
const tracer=fs.readFileSync(path.join(here,'armor-bvh.glsl'),'utf8');
const testedTracer=negative?tracer
 .replace('left?oc_bvh_triangle(origin,direction,v[3],v[2],v[1],candidate)\n                           :oc_bvh_triangle(origin,direction,v[0],v[1],v[2],candidate)',
          'oc_bvh_triangle(origin,direction,v[0],v[1],v[2],candidate)')
 .replace('left?oc_bvh_triangle(origin,direction,v[1],v[0],v[3],candidate)\n                       :oc_bvh_triangle(origin,direction,v[2],v[3],v[0],candidate)',
          'oc_bvh_triangle(origin,direction,v[2],v[3],v[0],candidate)'):tracer;
if(negative&&testedTracer===tracer)throw Error('Negative control did not match current tracer');
const item=fs.readFileSync(path.join(here,'item-affine.glsl'),'utf8');
const preamble=`#version 330 core
#define ENTITY
#define NO_CARDINAL_LIGHTING
#define OC_PORTABLE_CELL_SIZE 8.0
uniform sampler2D Sampler0;
uniform mat4 ProjMat,ModelViewMat;
uniform float GameTime;
uniform vec3 oc_carrier_positions[4],oc_source_normal;
vec2 oc_carrier_uvs[4];
vec4 oc_control_color=vec4(1.0),vertexColor;
uniform vec4 oc_parameters,oc_decoded0,oc_decoded1,oc_decoded2,oc_decoded_uv01;
uniform vec4 oc_p0,oc_p1,oc_p2,oc_p3,oc_high01,oc_high12,oc_high23;
uniform vec2 Resolution;
struct OcDecodedVertex{vec3 position;vec2 uv;vec2 uv2;float blend;vec4 overlay;int custom;int gui;int hand;int shadow;};
out vec4 result;
`;
const main=`
void main(){
 int face=oc_armor_bvh_trace(gl_FragCoord.xy/Resolution*2.0-1.0);
 vec3 center=vec3(0.0);
 if(face>=0){
  OcDecodedVertex vertex[4];
  if(!oc_decode_armor_bvh(face,vertex)){result=vec4(-99);return;}
  for(int i=0;i<4;i++)center+=vertex[i].position*.25;
  center=(ModelViewMat*vec4(center,1.0)).xyz;
 }
 result=vec4(float(face+1),center);
}`;
for(const zero of [0,1])fs.writeFileSync(path.join(directory,`trace${zero}.frag`),
 preamble+(zero?'#define RENDERPEARL_DEPTH_IS_ZERO_TO_ONE\n':'')+tools+armor+item+bvh+testedTracer+main);
fs.writeFileSync(path.join(directory,'fullscreen.vert'),`#version 330 core
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2-1,0,1);}
`);
const sha=s=>createHash('sha256').update(s).digest('hex');
fs.writeFileSync(path.join(directory,'inputs.json'),JSON.stringify({input,negativeLeftDiagonal:negative,tracerSha256:sha(tracer),armorAffineSha256:sha(armor),bvhHelpersSha256:sha(bvh)},null,2)+'\n');
console.log(`Prepared actual AS2 tracer and pose, ${png.width}x${png.height}`);
