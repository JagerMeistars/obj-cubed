import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {PNG}=require('pngjs');
const {loadObjcubedWithContext}=require('../test/helpers/load-plugin.cjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'audit/2026-10-11/skin-plugin'));
const pack=path.join(out,'pack');
const paint=new PNG({width:64,height:64});
for(let y=0;y<64;y++)for(let x=0;x<64;x++)paint.data.set(((x>>3)+(y>>3))%2?[17,23,253,255]:[230,120,25,255],4*(y*64+x));
const paintSource='data:image/png;base64,'+PNG.sync.write(paint).toString('base64');
class Image {set src(value){this.rgba=PNG.sync.read(Buffer.from(value.split(',')[1],'base64'));queueMicrotask(()=>this.onload());}get naturalWidth(){return this.rgba.width;}get naturalHeight(){return this.rgba.height;}}
const {api}=loadObjcubedWithContext({globals:{Buffer,process,setTimeout,
 Image,document:{createElement(){let img;return {getContext(){return {drawImage(value){img=value;},getImageData(){return img.rgba;}};}};}},
 Texture:{all:[{uuid:'skinuv',name:'skin reference',objcubed_player_skin:true,width:64,height:64,frameCount:1},{uuid:'paint',name:'paint',width:64,height:64,source:paintSource,frameCount:1}]},Outliner:{root:[]},
 Project:{name:'skin_arm'},BarItems:{},Blockbench:{showQuickMessage(){},pickDirectory(){throw Error('Unexpected dialog');}}}});
function frame(t,mixed=false){
 const lines=['usemtl m_skinuv'];let index=1;const angle=Math.sin(t)*.8;
 for(let seg=0;seg<2;seg++){
  const points=[[-.18,seg*.6,-.18],[.18,seg*.6,-.18],[-.18,(seg+1)*.6,-.18],[.18,(seg+1)*.6,-.18],[-.18,seg*.6,.18],[.18,seg*.6,.18],[-.18,(seg+1)*.6,.18],[.18,(seg+1)*.6,.18]];
  const faces=[[1,0,2,3],[4,5,7,6],[0,4,6,2],[5,1,3,7],[3,2,6,7],[4,0,1,5]];
  const uv=[[44/64,1-(20+seg*6)/64],[48/64,1-(20+seg*6)/64],[48/64,1-(26+seg*6)/64],[44/64,1-(26+seg*6)/64]];
  for(const [faceIndex,f] of faces.entries()){
   const normal=mixed&&faceIndex>=2;
   lines.push('usemtl '+(normal?'m_paint':'m_skinuv'));
   const faceUv=normal?[[0,0],[1,0],[1,1],[0,1]]:uv;
   for(let j=0;j<4;j++){let [x,y,z]=points[f[j]];if(seg){const dy=y-.6;y=.6+Math.cos(angle)*dy;z+=Math.sin(angle)*dy;}lines.push(`v ${x} ${y} ${z}`,`vt ${faceUv[j].join(' ')}`);}lines.push('f '+[0,1,2,3].map(i=>`${index+i}/${index+i}`).join(' '));index+=4;
  }
 }return lines.join('\n');
}
for(const [cmdName,skinSlot,mixed] of [['skin_arm',0,false],['skin_arm_2',1,false],['skin_faces',0,true]]){
 const cfg={texIndex:1,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:40,autoplay:true,easing:1,interpolation:0,noshadow:true,autorotate:3,visibility:7,displaySlots:{},flipuv:false,useAtlas:false,texAnimEnabled:false,
 skinEnabled:false,skinSlot,cmdName,resourcePackDir:pack,datapackOutputDir:path.join(out,'datapacks')};
 const result=await api.buildOutput(cfg,Array.from({length:24},(_,i)=>frame(i*Math.PI*2/24,mixed)),'');
 await api.saveSingleOutput(result,{},cfg);
}
// Same generated authoring guide as the texture-panel action; never baked into the RP.
const reference=api.skinReferenceImage();
const texId='70000000-0000-4000-8000-000000000001',cubeId='70000000-0000-4000-8000-000000000002',boneId='70000000-0000-4000-8000-000000000003';
const uv={north:[44,20,48,32],south:[52,20,56,32],west:[48,20,52,32],east:[40,20,44,32],up:[48,20,44,16],down:[52,16,48,20]};
const project={meta:{format_version:'4.10',model_format:'free',box_uv:false},name:'skin_arm',model_identifier:'skin_arm',resolution:{width:64,height:64},
 elements:[{name:'arm',type:'cube',uuid:cubeId,from:[-2,0,-2],to:[2,12,2],origin:[0,12,0],box_uv:false,faces:Object.fromEntries(Object.entries(uv).map(([k,uv])=>[k,{uv,texture:0}]))}],
 outliner:[{name:'arm',uuid:boneId,origin:[0,12,0],rotation:[0,0,0],children:[cubeId]}],
 textures:[{uuid:texId,name:'Player skin (profile)',objcubed_player_skin:true,id:'0',width:64,height:64,uv_width:64,uv_height:64,mode:'bitmap',saved:false,source:'data:image/png;base64,'+reference.toString('base64')}],
 animations:[{uuid:'70000000-0000-4000-8000-000000000004',name:'wave',loop:'loop',length:2,snapping:20,animators:{[boneId]:{name:'arm',type:'bone',keyframes:[0,1,2].map((time,i)=>({channel:'rotation',data_points:[{x:i===1?'45':'0',y:'0',z:'0'}],time,interpolation:'linear',uuid:`70000000-0000-4000-8000-00000000000${i+5}`}))}}}],
 objcubed:{version:1,settings:{skinEnabled:false,skinSlot:0,selectedTex:0,useAtlas:false,baseItem:'player_head',cmdName:'skin_arm',animationEnabled:true,animFps:20,animStart:0,animEnd:2,autoplay:true}}};
fs.writeFileSync(path.join(out,'skin_arm.bbmodel'),JSON.stringify(project,null,2));
const mixedProject=structuredClone(project);
mixedProject.name=mixedProject.model_identifier=mixedProject.objcubed.settings.cmdName='skin_faces';
mixedProject.textures.push({uuid:'70000000-0000-4000-8000-000000000009',name:'paint.png',id:'1',width:64,height:64,uv_width:64,uv_height:64,mode:'bitmap',saved:false,source:paintSource});
for(const side of ['west','east','up','down'])mixedProject.elements[0].faces[side]={uv:[0,0,64,64],texture:1};
fs.writeFileSync(path.join(out,'skin_faces.bbmodel'),JSON.stringify(mixedProject,null,2));
console.log('Real exporter fixtures, merged binding datapack, editable arm:',out);
