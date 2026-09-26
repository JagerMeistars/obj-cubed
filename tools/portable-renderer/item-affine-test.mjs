// Prepare a real-driver parity shader from the existing decoder, not a CPU copy.
// Usage: node tools/portable-renderer/item-affine-test.mjs exported-item.png OUT
// Then compile/run item-affine-test.c as documented in item-affine.md.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const require=createRequire(path.join(repo,'package.json'));
const {PNG}=require('pngjs');
const [input,directory]=process.argv.slice(2);
if(!input||!directory) throw new Error('Usage: node item-affine-test.mjs exported-item.png OUT');
const out=path.resolve(directory);
fs.mkdirSync(out,{recursive:true});
const png=PNG.sync.read(fs.readFileSync(input));
if(png.data[0]!==12||png.data[1]!==34||png.data[2]!==56||png.data[3]!==255)
  throw new Error('Input must be an exported item PNG');
fs.writeFileSync(path.join(out,'texture.rgba'),png.data);
fs.writeFileSync(path.join(out,'size.txt'),`${png.width} ${png.height}\n`);
const include=path.join(repo,'objcubed/assets/minecraft/shaders/include');
let main=fs.readFileSync(path.join(include,'objmc_main.glsl'),'utf8');
// Only the existing item branch is relevant. Armor remains a separate decoder.
const armor=main.indexOf('\n#ifdef ENTITY\nif (isCustom == 0)');
if(armor<0)throw new Error('Item/armor boundary changed');
main=main.slice(0,armor);
const canonical=main.replace(/bvec3 visibility = bvec3\([^;]+;/,'bvec3 visibility = bvec3(true);');
if(canonical===main)throw new Error('Visibility declaration changed');
let tools=fs.readFileSync(path.join(include,'objmc_tools.glsl'),'utf8');
tools=tools.replace(/\/\/ Minecraft 26\.3[\s\S]*?#include <minecraft:objmc_carrier.glsl>/,`#define OBJMC_VERTEX_ID virtualID
void oc_read_carrier(vec3 p,vec2 uv,out vec3 positions[4],out vec2 uvs[4]) {
  const vec3 unit[4]=vec3[4](vec3(1,1,0),vec3(1,0,0),vec3(0),vec3(0,1,0));
  for(int i=0;i<4;i++) {
    positions[i]=canonicalMode?unit[i]:Carrier[i];
    uvs[i]=canonicalMode?(vec2(MarkerPixel)+0.5)/vec2(textureSize(Sampler0,0)):CarrierUV[i];
  }
}`);
const preamble=`#version 330 core
#define ENTITY
uniform sampler2D Sampler0;
uniform mat4 ProjMat;
uniform float GameTime;
uniform vec3 Carrier[4]; uniform vec2 CarrierUV[4]; uniform ivec2 MarkerPixel;
uniform vec4 Color;
uniform int CyclicOffset;
vec3 Pos;vec2 UV0,texCoord,texCoord2;float transition;vec4 overlayColor;
int isCustom,isGUI,isHand,noshadow,virtualID;
bool canonicalMode;
struct Decoded{vec3 p;vec2 uv,uv2;float blend;vec4 tint;int gui,hand,shadow;};
`;
const setup=`
virtualID=cornerID;
UV0=CarrierUV[cornerID];
Pos=Carrier[cornerID];
texCoord=UV0;texCoord2=UV0;transition=0.0;overlayColor=vec4(1.0);
isCustom=0;isGUI=0;isHand=0;noshadow=0;
`;
const finish=`Decoded d;d.p=Pos;d.uv=texCoord;d.uv2=texCoord2;d.blend=transition;
d.tint=overlayColor;d.gui=isGUI;d.hand=isHand;d.shadow=noshadow;return d;\n}`;
const shader=preamble+tools+`
Decoded actual(int cornerID){canonicalMode=false;${setup}${main}${finish}
Decoded canonical(int cornerID){canonicalMode=true;${setup}${canonical}${finish}
`+fs.readFileSync(path.join(here,'item-affine.glsl'),'utf8')+`
out vec4 result;
void main(){
  Decoded a=actual(gl_VertexID);Decoded c=canonical(gl_VertexID);
  vec3 sourcePos[4],orderedPos[4];vec2 sourceUV[4],orderedUV[4];
  for(int i=0;i<4;i++){sourcePos[i]=Carrier[(i+CyclicOffset)&3];sourceUV[i]=CarrierUV[(i+CyclicOffset)&3];}
  bool ordered=oc_item_order_carrier(sourcePos,sourceUV,orderedPos,orderedUV);
  OcItemAffine pose=oc_item_affine_init(orderedPos,orderedUV,MarkerPixel,c.gui!=0);
  vec3 got=oc_item_affine_apply(pose,c.p);
  vec3 delta=abs(got-a.p);
  float pe=pose.visible?max(delta.x,max(delta.y,delta.z)):length(a.p-Carrier[2]);
  float ue=pose.visible?max(length(c.uv-a.uv),length(c.uv2-a.uv2)):0.0;
  float other=pose.visible?(abs(c.blend-a.blend)+length(c.tint-a.tint)):0.0;
  other+=float(pose.hand!=a.hand||pose.gui!=a.gui||c.shadow!=a.shadow);
  other+=ordered?0.0:1.0;
  if(any(isnan(got))||any(isinf(got)))pe=1e20;
  result=vec4(pe,ue,other,pose.visible?1.0:0.0);
  gl_Position=vec4(0,0,0,1);
}
`;
fs.writeFileSync(path.join(out,'parity.vert'),shader);
fs.writeFileSync(path.join(out,'parity-block.vert'),shader.replace('#define ENTITY','#define BLOCK'));
console.log(`Prepared ${png.width}x${png.height} texture and original-decoder parity shaders in ${out}`);
