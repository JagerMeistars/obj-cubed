// Run with run-windows-check.ps1 -Mode raster. The reference quad samples a
// CPU-lit gradient computed from the source normals, not the exported bytes.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {expandShader} from '../../test/helpers/shader-includes.mjs';
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../../test/helpers/load-plugin.cjs');
const out=path.resolve(process.argv[2]||'audit/smooth-shading'), rp=path.resolve('objcubed');
const van=path.resolve(process.argv[3]||'audit/2026-09-28/vanilla');
fs.mkdirSync(out,{recursive:true});
for(const [suffix,stage] of [['vsh','vert'],['fsh','frag']]){
 const src=expandShader(path.join(rp,'assets/minecraft/shaders/core/item.'+suffix),[rp,van]);
 fs.writeFileSync(path.join(out,'shader.'+stage),src.replace(/^(#version[^\n]*\n)/,'$1#define NO_OVERLAY\n#define EMISSIVE\n'));
}
const white=Buffer.alloc(16*16*4,255);
class Image {set src(_){queueMicrotask(()=>this.onload());}get naturalWidth(){return 16;}get naturalHeight(){return 16;}}
const {api}=loadObjcubedWithContext({globals:{Buffer,Image,setTimeout,process,
 document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data:white,width:16,height:16})})})},
 Texture:{all:[{uuid:'w',name:'white',source:'data:white',img:{src:'data:white'}}]},Outliner:{root:[]}}});
const vs=[[-.7,.05,0],[.7,.05,0],[.7,.95,0],[-.7,.95,0]], uv=[[0,0],[1,0],[1,1],[0,1]];
const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
// Choose a representable direction so this oracle measures interpolation and
// transforms, independently of the lossy normal encoding's angular error.
const left=norm([-48/63,0,1-48/63]), right=[0,0,1];
function obj(reverse=false) {
 const positions=vs.slice(), faces=[[0,1,2,3]];
 // Equal-area side quads tilt the middle quad's shared normals to the specified directions.
 for(const [a,b,sign,n] of [[0,3,1,reverse?right:left],[2,1,-1,reverse?left:right]]) {
  const span=vs[1][0]-vs[0][0], dx=sign*span*(1-2*n[2]*n[2]), dz=sign*span*2*n[2]*n[0], k=positions.length;
  for(const i of [b,a]) positions.push([vs[i][0]+dx,vs[i][1],vs[i][2]+dz]);
  faces.push([a,b,k,k+1]);
 }
 return ['usemtl m_w',...positions.map(v=>'v '+v.join(' ')),...uv.map(v=>'vt '+v.join(' ')),
  ...faces.map(face=>'f '+face.map((v,i)=>`${v+1}/${i+1}`).join(' '))].join('\n');
}
const written=[];
for(const [id,s,slot,flat,anim] of [
 ['flat',[1,1,1],'fixed',true,false],['smooth',[1,1,1],'fixed',false,false],
 ['stretched',[.73,1.22,.48],'fixed',false,false],['mirrored_hand',[-.76,1.24,.59],'firstperson_righthand',false,false],
 ['animation_half',[1,1,1],'fixed',false,true],
]){
 const dir=path.join(out,id);fs.mkdirSync(dir,{recursive:true});
 const displaySlots={[slot]:{scale:s,rotation:[0,0,0],translation:[0,0,0]}};
 const cfg={texIndex:0,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],
  duration:2,autoplay:anim,easing:1,interpolation:0,noshadow:false,autorotate:0,visibility:7,displaySlots,useAtlas:false,shadingMode:flat?'flat':'smooth'};
 const exp=await api.buildOutput(cfg,anim?[obj(),obj(true)]:[obj()],'');
 const elements=api.calibratedElementsForSlot(exp.elements,slot,api.assignSlotMarkers(displaySlots).ids.get(slot)||0).slice(0,1);
 const carrier=[],reference=[];
 for(const e of elements){const [x0,y0,z0]=e.from,[x1,y1]=e.to,u=e.faces.north.uv;
  const xyz=[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]], tu=[[u[0],u[1]],[u[0],u[3]],[u[2],u[3]],[u[2],u[1]]];
  for(let k=0;k<4;k++)carrier.push(...xyz[k].map((v,a)=>(v/16-.5)*s[a]),...tu[k].map(v=>v/16));
 }
 for(let k=0;k<4;k++)reference.push(...vs[k].map((v,a)=>(v-(a===1?.5:0))*s[a]),uv[k][0],.5);
 const w=1024, gradient=Buffer.alloc(w*4);
 const posed=n=>norm(n.map((c,a)=>c/s[a]));
 const nl=posed(anim?norm(left.map((v,j)=>(v+right[j])/2)):left), nr=posed(anim?norm(left.map((v,j)=>(v+right[j])/2)):right);
 for(let x=0;x<w;x++){
  const k=(x+.5)/w, n=flat?[0,0,1]:norm(nl.map((c,i)=>c*(1-k)+nr[i]*k));
  const shade=Math.round(255*Math.min(1,.4+.6*(Math.max(n[1],0)+Math.max(n[2],0))));
  gradient.set([shade,shade,shade,255],x*4);
 }
 fs.writeFileSync(path.join(dir,'texture.rgba'),exp.rawBuf);fs.writeFileSync(path.join(dir,'reference.rgba'),gradient);
 for(const [filename,data] of [['carrier',carrier],['reference',reference]])
  fs.writeFileSync(path.join(dir,filename+'.f32'),Buffer.from(new Float32Array(data).buffer));
 fs.writeFileSync(path.join(dir,'meta.txt'),[exp.tw,exp.ty,w,1,carrier.length/5,0,anim?.5:0].join(' '));
 written.push(dir);
}
fs.writeFileSync(path.join(out,'cases.txt'),written.join('\n'));
