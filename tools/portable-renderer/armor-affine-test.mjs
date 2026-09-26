// Compare AS1 vertex predecode + cheap fragment pose with the original armor
// branch, using the same exhaustive carrier/playback fixtures as armor-fast.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const out=path.resolve(process.argv[2]||'work/armor-affine-validation');
const result=spawnSync(process.execPath,[path.join(here,'armor-fast-test.mjs'),out],{stdio:'inherit'});
if(result.status) process.exit(result.status);
// Compile both halves in one transform-feedback stage. Only the stage-selector
// preprocessor lines are removed; all executable helper code is unchanged.
let helper=fs.readFileSync(path.join(here,'armor-affine.glsl'),'utf8')
 .replace(/\/\/ AS1 position-only carrier\.[\s\S]*?(?=bool oc_apply_armor_as1)/,'')
 .replace('#ifdef OC_PORTABLE_VERTEX\n','')
 .replace('\n#else\nbool oc_apply_armor_as1','\nbool oc_apply_armor_as1')
 .replace(/\n#endif\n#endif\s*$/,'\n#endif\n');
for(const lighting of ['cardinal','NO_CARDINAL_LIGHTING','PER_FACE_LIGHTING']) {
 const filename=path.join(out,`parity-${lighting}.vert`);
 let shader=fs.readFileSync(filename,'utf8');
 shader=shader.slice(0,shader.indexOf('\nbool oc_discarded=false;'));
 shader=shader.replace('uniform vec3 oc_carrier_positions[4];uniform vec2 oc_carrier_uvs[4];',
  'uniform vec3 input_positions[4];uniform vec2 input_uvs[4];\nvec3 oc_carrier_positions[4];vec2 oc_carrier_uvs[4];');
 shader=shader.replace('uniform sampler2D Sampler0;',`uniform sampler2D Sampler0,Sampler1;
bool oc_compact=false;
vec4 oc_read_texel(ivec2 position,int level){return oc_compact?texelFetch(Sampler1,position,level):texelFetch(Sampler0,position,level);}
ivec2 oc_texture_size(int level){return oc_compact?textureSize(Sampler1,level):textureSize(Sampler0,level);}
vec4 oc_parameters;`);
 shader+=helper+`
out vec4 result;
void main(){
 for(int i=0;i<4;i++){oc_carrier_positions[i]=input_positions[i];oc_carrier_uvs[i]=input_uvs[i];}
 OcDecodedVertex a=original(gl_VertexID);
 vec4 light0=vertexColor,light1=vertexPerFaceColorFront,light2=vertexPerFaceColorBack;
 vec2 midpoint=(input_uvs[0]+input_uvs[1]+input_uvs[2]+input_uvs[3])*.25;
 int own=0;
 for(int i=0;i<4;i++){
  int corner=input_uvs[i].x>midpoint.x?(input_uvs[i].y<midpoint.y?0:3):(input_uvs[i].y<midpoint.y?1:2);
  oc_carrier_positions[corner]=input_positions[i];oc_carrier_uvs[corner]=input_uvs[i];
  if(i==gl_VertexID)own=corner;
 }
 oc_compact=true;
 OcDecodedVertex decoded[4],b[4];int flags;
 oc_decode_armor_as1(decoded,flags);
 vec3 localPos[4];vec2 uv[4];
 for(int i=0;i<4;i++){localPos[i]=decoded[i].position;uv[i]=decoded[i].uv;}
 oc_parameters=vec4(decoded[0].uv2.y-decoded[0].uv.y,decoded[0].blend,float(flags),4.0);
 bool visible=oc_apply_armor_as1(flags,localPos,uv,b);
 bool hidden=all(equal(a.position,vec3(9999.0)));
 vec3 d=abs(a.position-b[own].position);float pe=max(d.x,max(d.y,d.z));
 // Static secondary UVs are unobservable because transition is zero.
 float ue=length(a.uv-b[own].uv);if(a.blend>0.0)ue=max(ue,length(a.uv2-b[own].uv2));
 float other=abs(a.blend-b[own].blend)+length(a.overlay-b[own].overlay);
 other+=float(a.custom!=b[own].custom||a.gui!=b[own].gui||a.hand!=b[own].hand||a.shadow!=b[own].shadow);
 #ifdef PER_FACE_LIGHTING
 other+=length(light1-vertexPerFaceColorFront)+length(light2-vertexPerFaceColorBack);
 #else
 other+=length(light0-vertexColor);
 #endif
 if(hidden||!visible){pe=0.0;ue=0.0;other=float(hidden==visible);}
 if(!hidden&&(any(isnan(b[own].position))||any(isinf(b[own].position))))pe=1e20;
 result=vec4(pe,ue,other,hidden?1.0:0.0);gl_Position=vec4(0,0,0,1);
}`;
 // Route the test reference and AS1 helper to their two separate textures.
 // Keep the wrapper's own native reads untouched.
 const end=shader.indexOf('vec4 oc_parameters;')+'vec4 oc_parameters;'.length;
 shader=shader.slice(0,end)+shader.slice(end)
  .replaceAll('texelFetch(Sampler0,','oc_read_texel(')
  .replaceAll('textureSize(Sampler0,','oc_texture_size(');
 // The native runner retains the fixture uniform names.
 shader=shader.replaceAll('input_positions','oc_input_positions').replaceAll('input_uvs','oc_input_uvs');
 fs.writeFileSync(filename,shader);
}
console.log('Prepared AS1 exact-reference parity programs.');
