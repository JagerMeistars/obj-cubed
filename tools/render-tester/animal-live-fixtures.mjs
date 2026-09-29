// Real plugin exports for isolated Minecraft visual checks, not FPS benchmarks.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {box,obj,image} from './horse-fixture-library.mjs';
const require=createRequire(import.meta.url);
const {loadPlugin}=require('../../test/helpers/load-plugin.cjs');
const {makeMemFs}=require('../../test/helpers/mem-fs.cjs');
const memory=makeMemFs();
const destination=path.resolve(process.argv[2]||'audit/2026-09-29/equipment-expansion/live-fixtures');
const im=image(3,0);
class Image {set src(_){queueMicrotask(()=>this.onload());}get naturalWidth(){return im.width;}get naturalHeight(){return im.height;}}
const api=loadPlugin(path.resolve('objcubed.js'),{requireImpl:id=>id==='fs'?memory:id==='path'?path.posix:require(id),globals:{
  Buffer,Image,process,console:{log(){},warn(){},error:console.error},
  document:{createElement(){return{getContext(){return{drawImage(){},getImageData(){return im;}};}};}},
  Texture:{all:[{uuid:'texture',source:'data:test',frameCount:3,uv_width:32,uv_height:32}]},
  Outliner:{root:[],elements:[]},Project:{name:'animal_live',export_path:''},BarItems:{},Blockbench:{export(){throw Error('Unexpected dialog');}},
}});
const models=[];
for(const [target,catalog] of Object.entries(api.EQUIPMENT_CARRIERS)) {
  const faces=[],bindings=[];
  for(const [part,carrier] of Object.entries(catalog.bindings)) {
    const points=carrier.quads.flatMap(q=>[q.q0,q.q1,q.q3]).map(p=>[p[0],-p[1],p[2]]);
    // Thin protruding colored shells expose each native attachment without relying
    // on the target animal's opaque texture being invisible.
    const lo=[0,1,2].map(a=>Math.min(...points.map(p=>p[a]))-.065);
    const hi=[0,1,2].map(a=>Math.max(...points.map(p=>p[a]))+.065);
    faces.push(...box(lo,hi));
    bindings.push(...Array.from({length:6},()=>({part,pivot:[0,0,0],key:part})));
  }
  const cfg={texIndex:0,nopow:false,scale:1,offset:[0,0,0],colorbehavior:['time','time','time'],
    duration:2,autoplay:false,easing:1,interpolation:0,noshadow:true,autorotate:0,visibility:7,displaySlots:{},
    flipuv:false,useAtlas:false,texAnimEnabled:true,texFrametime:4,texFade:false,
    resourcePackDir:'/rp',baseItem:'stick',generateDatapack:true,datapackNamespace:'animal_live',
    datapackAnimId:target,datapackOutputDir:'/datapacks',datapackTargetType:'equipment',
    cmdName:'animal_live_'+target,exportAsEquipment:true,equipmentTarget:target,selectedPieces:[]};
  const frames=[faces,faces.map(q=>q.map(p=>[p[0],p[1]+.03,p[2]]))];
  const result=await api.buildOutput(cfg,frames.map(q=>obj(q,face=>Math.floor(face/6)%2?15:0)),'');
  result.faceToEquipmentBinding=bindings;
  await api.saveSingleOutput(result,api.buildDisplayTransforms(cfg),cfg);
  const eq=api.equipmentOf(cfg),asset=cfg.cmdName+'_'+target;
  models.push({target,asset,entity:eq.entity,item:eq.item,slot:eq.slot,component:{...eq.component,asset_id:'minecraft:'+asset},
    parts:Object.keys(catalog.bindings),faces:faces.length});
}
for(const[file,bytes]of memory.writes){
  const relative=file.startsWith('/rp/')?file.slice(4):file.startsWith('/datapacks/')?'datapacks/'+file.slice(11):null;
  if(!relative)continue;
  const output=path.join(destination,relative);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);
}
fs.copyFileSync('objcubed/pack.mcmeta',path.join(destination,'pack.mcmeta'));
fs.writeFileSync(path.join(destination,'fixtures.json'),JSON.stringify({scope:'Actual plugin exports for native in-game rendering; no FPS measurements.',models},null,2));
console.log(destination);
