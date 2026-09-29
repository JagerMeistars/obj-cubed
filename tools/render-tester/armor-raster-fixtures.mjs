// Direct-port vs release vertex-decoder comparison on synthetic humanoid boxes.
// The reference uses the *unmodified* release objmc_main/tools includes with
// today's interface wrapper. It bypasses ShaderC, as Minecraft 26.2 OpenGL did.
// It proves port parity, not whether the original armor calibration is correct.
// Usage: node tools/render-tester/armor-raster-fixtures.mjs <out> <vanilla> <equipment-root>
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {PNG} from 'pngjs';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const out=path.resolve(process.argv[2]),vanilla=path.resolve(process.argv[3]),equipment=path.resolve(process.argv[4]);
fs.mkdirSync(out,{recursive:true});
const source=path.resolve('objcubed');
const baselineTools=execFileSync('git',['show','41bf938:objcubed/assets/minecraft/shaders/include/objmc_tools.glsl'],{encoding:'utf8'});
const baselineMain=execFileSync('git',['show','41bf938:objcubed/assets/minecraft/shaders/include/objmc_main.glsl'],{encoding:'utf8'});
for(const [suffix,stage]of [['vsh','vert'],['fsh','frag']]){
 let text=expandShader(path.join(source,`assets/minecraft/shaders/core/entity.${suffix}`),[source,vanilla]);
 text=text.replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n#define PER_FACE_LIGHTING\n');
 fs.writeFileSync(path.join(out,'shader.'+stage),text);
 if(stage==='vert'){
  const replaceInclude=(src,name,replacement)=>src.replace(new RegExp('// begin <minecraft:'+name+'\\.glsl>[\\s\\S]*?// end <minecraft:'+name+'\\.glsl>'),()=>replacement);
  let baseline=replaceInclude(text,'objmc_tools',baselineTools);baseline=replaceInclude(baseline,'objmc_main',baselineMain);
  baseline=baseline.replace('GL_KHR_shader_subgroup_ballot','GL_KHR_shader_subgroup_quad');
  fs.writeFileSync(path.join(out,'baseline.vert'),baseline);
 }
}
function rot(v,r){const[x,y,z]=r.map(t=>t*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);let[a,b,c]=v;[a,b]=[a*cz-b*sz,a*sz+b*cz];[a,c]=[a*cy+c*sy,-a*sy+c*cy];return[a,b*cx-c*sx,b*sx+c*cx];}
function floats(file,values){const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));fs.writeFileSync(file,b);}
const parts=[{name:'body',o:[16,16],size:[8,12,4],at:[0,0,0]},{name:'right_arm',o:[40,16],size:[4,12,4],at:[-.43,0,0]},{name:'left_arm',o:[40,16],size:[4,12,4],at:[.43,0,0],mirror:true}];
const cases=[];
for(const pose of [false,true])for(const wearer of [1,.9375])for(const layer of [0,1]){
 const name=`${pose?'posed':'rest'}-${wearer===1?'stand':'player'}-layer${layer}`,dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});
 const png=PNG.sync.read(fs.readFileSync(path.join(equipment,`audit_armor_chestplate_${layer}.png`)));fs.writeFileSync(path.join(dir,'texture.rgba'),png.data);fs.writeFileSync(path.join(dir,'reference.rgba'),png.data);
 const vertices=[];
 for(const [pi,p]of parts.entries()){
  const[w,h,d]=p.size,[ox,oy]=p.o,lo=[-(w+2)/32,-(h+2)/32,-(d+2)/32],hi=lo.map(x=>-x);
  // TR,TL,BL,BR UV roles. Top/bottom are included to verify proper culling.
  const faces=[
   {v:[[hi[0],lo[1],hi[2]],[lo[0],lo[1],hi[2]],[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]]],uv:[ox+d+w,oy,ox+d+2*w,oy+d],n:[0,1,0]},
   {v:[[hi[0],hi[1],lo[2]],[lo[0],hi[1],lo[2]],[lo[0],hi[1],hi[2]],[hi[0],hi[1],hi[2]]],uv:[ox+d,oy,ox+d+w,oy+d],n:[0,-1,0]},
   {v:[[lo[0],lo[1],lo[2]],[lo[0],lo[1],hi[2]],[lo[0],hi[1],hi[2]],[lo[0],hi[1],lo[2]]],uv:[ox,oy+d,ox+d,oy+d+h],n:[-1,0,0]},
   {v:[[hi[0],lo[1],lo[2]],[lo[0],lo[1],lo[2]],[lo[0],hi[1],lo[2]],[hi[0],hi[1],lo[2]]],uv:[ox+d,oy+d,ox+d+w,oy+d+h],n:[0,0,-1]},
   {v:[[hi[0],lo[1],hi[2]],[hi[0],lo[1],lo[2]],[hi[0],hi[1],lo[2]],[hi[0],hi[1],hi[2]]],uv:[ox+d+w,oy+d,ox+2*d+w,oy+d+h],n:[1,0,0]},
   {v:[[lo[0],lo[1],hi[2]],[hi[0],lo[1],hi[2]],[hi[0],hi[1],hi[2]],[lo[0],hi[1],hi[2]]],uv:[ox+2*d+w,oy+d,ox+2*d+2*w,oy+d+h],n:[0,0,1]},
  ];
  for(const f of faces){const[u0,v0,u1,v1]=f.uv,uv=[[u1,v0],[u0,v0],[u0,v1],[u1,v1]],r=pose?(pi===0?[11,19,-7]:pi===1?[-35,23,17]:[28,-41,-22]):[0,0,0];
   for(let k=0;k<4;k++){let v=[...f.v[k]],n=[...f.n];if(p.mirror){v[0]*=-1;n[0]*=-1;}v=rot(v,r).map((a,i)=>(a+p.at[i])*wearer);n=rot(n,r);v=rot(v,[5,-27,0]);n=rot(n,[5,-27,0]);vertices.push(...v,uv[k][0]/64,uv[k][1]/32,...n);}
  }
 }
 floats(path.join(dir,'carrier.f32'),vertices);floats(path.join(dir,'reference.f32'),vertices);
 fs.writeFileSync(path.join(dir,'meta.txt'),[png.width,png.height,png.width,png.height,vertices.length/8,pose?28:0,0,8].join(' '));cases.push(dir);
}
fs.writeFileSync(path.join(out,'cases.txt'),cases.join('\n'));
fs.writeFileSync(path.join(out,'methodology.txt'),'Synthetic body/right-arm/mirrored-left-arm carrier cubes, outer inflation 1, two equipment layers, rest and arbitrary limb poses, wearer scale 1/.9375, reversed depth. Reference: release41bf938 main/tools in current uniform/interface wrapper, raw OpenGL subgroupQuadBroadcast. Direct: current main/tools through exact26.3 ShaderC/SPVC. Same current fragment shader for both; validates vertex decoder migration only, not original armor alignment or game scheduling.\n');
console.log(`Prepared ${cases.length} armor parity cases: ${out}`);
