import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../helpers/load-plugin.cjs');
const {makeMemFs}=require('../helpers/mem-fs.cjs');
const path=require('node:path');
const OBJ='v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl m_u\nf 1/1 2/2 3/3 4/4';
function setup(){
 const memfs=makeMemFs();let decoded=0;
 class Image{set src(_){decoded++;queueMicrotask(()=>this.onload());}get naturalWidth(){return 64;}get naturalHeight(){return 64;}}
 const {api,context}=loadObjcubedWithContext({requireImpl:id=>id==='fs'?memfs:id==='path'?path.posix:require(id),globals:{Buffer,Image,process,setTimeout,
 Project:{name:'skin_arm'},BarItems:{},Blockbench:{pickDirectory(){return '/rp';}},Outliner:{root:[]},
 Texture:{all:[{uuid:'u',name:'reference',width:64,height:64,source:'private-skin',img:{naturalWidth:64,naturalHeight:64}}]},
 document:{createElement(){return {getContext(){return {drawImage(){},getImageData(){return {width:64,height:64,data:new Uint8Array(64*64*4).fill(99)};}};}};}}}});
 return {api,context,memfs,decoded:()=>decoded};
}
const cfg={texIndex:0,scale:1,offset:[0,0,0],colorbehavior:['direct','direct','direct'],duration:20,autoplay:true,easing:1,interpolation:0,noshadow:false,autorotate:3,visibility:7,displaySlots:{},useAtlas:false,skinEnabled:true,skinSlot:0,resourcePackDir:'/rp',datapackOutputDir:'/dp',baseItem:'iron_ingot',cmdName:'skin_arm'};
const SKIN_CONTEXTS=['thirdperson_righthand','thirdperson_lefthand','firstperson_righthand','firstperson_lefthand','head','gui','ground','fixed','on_shelf'];
function modelNodes(model) {
 return [model,...(model.models||[]).flatMap(modelNodes),...(model.cases||[]).flatMap(c=>modelNodes(c.model)),
  ...(model.entries||[]).flatMap(c=>modelNodes(c.model)),...(model.fallback?modelNodes(model.fallback):[])];
}
function expectDirectProfile(model) {
 const nodes=modelNodes(model),heads=nodes.filter(m=>m.type==='minecraft:special' && m.model?.type==='minecraft:player_head');
 expect(heads.length).toBeGreaterThan(0);
 // A vanilla head or the distant screen donor cannot render exported geometry.
 for(const head of heads) {
  expect(head.transformation.scale[0]).toBeGreaterThan(32);
  expect(head.transformation.translation[0]).toBe(0);
  expect(head.transformation.translation[2]).toBe(0);
  expect(Number.isFinite(head.transformation.translation[1])).toBe(true);
 }
 expect(nodes.some(m=>m.type==='minecraft:model')).toBe(false); // all faces use the profile
}
function expectWorldTransport(model) {
 const nodes=modelNodes(model);
 expect(nodes.some(m=>m.type==='minecraft:model')).toBe(true);
 const donor=nodes.find(m=>m.type==='minecraft:special' && m.model?.type==='minecraft:player_head');
 expect(donor.transformation.scale).toEqual([1,1,1]);
 expect(donor.transformation.translation[1]).toBeGreaterThanOrEqual(16384);
}
describe('player skin integration',()=>{
 it('uses the full mixed-model endpoint when choosing the profile loop period',async()=>{
  const {api,context}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  const mixed=OBJ+'\nv 3 0 0\nv 4 0 0\nv 4 1 0\nv 3 1 0\nusemtl m_paint\nf 5/1 6/2 7/3 8/4';
  const moved=mixed.replace('v 1 1 0','v 1 2 0');
  const closed=await api.buildOutput({...cfg,duration:4},[mixed,moved,mixed],'');
  expect(closed.nativeSkin.frames).toBe(3);
  expect(closed.nativeSkin.loopFrames).toBe(2);
  expect(closed.nativeSkin.duration).toBe(4);
  // The profile ends where it started, but the ordinary face does not.
  const open=await api.buildOutput({...cfg,duration:4},[mixed,moved,mixed.replace('v 4 1 0','v 4 2 0')],'');
  expect(open.nativeSkin.loopFrames).toBe(3);
  expect(open.rawBuf[open.tw*4+2]&4).toBe(0);
 });
 it('keeps legacy profile catalogs valid when a newer model is exported',async()=>{
  const {api,memfs}=setup();
  await api.saveSingleOutput(await api.buildOutput(cfg,[OBJ,OBJ.replace('v 1 1 0','v 1 2 0'),OBJ],''),{},cfg);
  const catalog=JSON.parse(memfs.writes.get('/rp/assets/objcubed/native_profiles.json'));
  expect(catalog.models.skin_arm.loopFrames).toBe(2);
  delete catalog.models.skin_arm.loopFrames;
  const shader=api.generateNativeSkinShader(catalog);
  expect(shader).toContain('int frame=int(phase)%3;');
  expect(shader).not.toMatch(/NaN|undefined/);
 });
 it('renders profile geometry directly in exported contexts while keeping scalable item_display transport',async()=>{
  const {api,memfs}=setup(),c={...cfg,selectedContexts:SKIN_CONTEXTS};
  await api.saveSingleOutput(await api.buildOutput(c,[OBJ],''),{},c);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const selector=item.model.cases.find(c=>c.when==='skin_arm').model;
  expect(selector.property).toBe('minecraft:display_context');
  for(const context of SKIN_CONTEXTS) {
   const entry=selector.cases.find(c=>c.when===context || Array.isArray(c.when) && c.when.includes(context));
   expect(entry,context).toBeDefined();
   expectDirectProfile(entry.model);
  }
  expectWorldTransport(selector.fallback);
 });
 it('renders unselected contexts directly without applying their disabled display transforms',async()=>{
  const {api,memfs}=setup(),c={...cfg,selectedContexts:['ground','fixed']};
  const out=await api.buildOutput(c,[OBJ],'');
  const transforms={
   ground:{rotation:[10,20,30],translation:[1,2,3],scale:[.5,1,2]},
   firstperson_righthand:{rotation:[60,70,80],translation:[4,5,6],scale:[2,3,4]},
  };
  await api.saveSingleOutput(out,transforms,c);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const selector=item.model.cases.find(c=>c.when==='skin_arm').model;
  expect(selector.cases.flatMap(c=>c.when).sort()).toEqual([...SKIN_CONTEXTS].sort());
  expectWorldTransport(selector.fallback);
  for(const entry of selector.cases) expectDirectProfile(entry.model);
  const firstShader=memfs.writes.get('/rp/assets/objcubed/shaders/include/profile_geometry.glsl');
  await api.saveSingleOutput(out,{ground:transforms.ground},c);
  expect(memfs.writes.get('/rp/assets/objcubed/shaders/include/profile_geometry.glsl')).toBe(firstShader);
 });
 it('uses the generated animation clock for world, GUI and player-preview contexts',async()=>{
  const {api,memfs}=setup(),c={...cfg,selectedContexts:SKIN_CONTEXTS,generateDatapack:true,colorbehavior:['time','time','time']};
  await api.saveSingleOutput(await api.buildOutput(c,[OBJ,OBJ.replace('v 1 1 0','v 1 2 0')],''),{},c);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const selector=item.model.cases.find(c=>c.when==='skin_arm').model;
  for(const model of selector.cases.map(c=>c.model)) {
   expect(model.type).toBe('minecraft:range_dispatch');
   expect(model.property).toBe('minecraft:custom_model_data');expect(model.index).toBe(0);
   expect(model.entries.map(e=>e.threshold)).toEqual([1,2,3,4]);
   expectDirectProfile(model);
  }
  expectWorldTransport(selector.fallback);
 });
 it.each([1,2,4])('keeps profile visibility mask %s separate for GUI, hands and world',async visibility=>{
  const {api,memfs}=setup(),c={...cfg,visibility,selectedContexts:SKIN_CONTEXTS};
  await api.saveSingleOutput(await api.buildOutput(c,[OBJ],''),{},c);
  const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/native_profiles.json')).models.skin_arm;
  const shader=memfs.writes.get('/rp/assets/objcubed/shaders/include/profile_geometry.glsl');
  const guard=shader.match(/if\(fi>=1\s*\|\|\s*!\(([^\n]+?)\)\)return true/);
  expect(guard).not.toBeNull();
  const isVisible=new Function('hand',`return (${guard[1]});`);
  for(const [index,context] of model.contexts.entries()) {
   const expected=visibility===1?context==='gui':visibility===2?context.startsWith('firstperson'):!context.startsWith('firstperson') && context!=='gui';
   expect(isVisible(index),context).toBe(expected);
  }
 });
 it('isolates the native mixed-material texture marker from the scalable world texture',async()=>{
  const {api,context,memfs}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  const c={...cfg,selectedContexts:SKIN_CONTEXTS},mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  const out=await api.buildOutput(c,[mixed],'');
  await api.saveSingleOutput(out,{},c);
  const {PNG}=require('pngjs');
  const ordinary=PNG.sync.read(Buffer.from(memfs.writes.get('/rp/assets/objcubed/textures/item/skin_arm.png')));
  const native=PNG.sync.read(Buffer.from(memfs.writes.get('/rp/assets/objcubed/textures/item/skin_arm_native.png')));
  const marker=(out.tw+5)*4+2;
  expect(ordinary.data[marker]).toBe(2);expect(native.data[marker]).toBe(3);
  expect(native.data[marker+1]).toBe(255); // keep metadata opaque for GUI preprocessing
  const differences=[];for(let i=0;i<ordinary.data.length;i++)if(ordinary.data[i]!==native.data[i])differences.push(i);
  expect(differences).toEqual([marker]);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const selector=item.model.cases.find(c=>c.when==='skin_arm').model;
  for(const entry of selector.cases) {
   const node=modelNodes(entry.model).find(m=>m.type==='minecraft:model');
   const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/models/'+node.model.split(':')[1]+'.json'));
   expect(model.textures['0']).toEqual({sprite:'objcubed:item/skin_arm_native',force_translucent:true});
  }
  const fallback=modelNodes(selector.fallback).filter(m=>m.type==='minecraft:model');
  for(const node of fallback) {
   const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/models/'+node.model.split(':')[1]+'.json'));
   expect(model.textures['0'].sprite).toBe('objcubed:item/skin_arm');
  }
 });
 it('keeps ordinary and profile faces aligned when a mixed model disables a transformed context',async()=>{
  const {api,context,memfs}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  const c={...cfg,selectedContexts:['ground','fixed']},mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  await api.saveSingleOutput(await api.buildOutput(c,[mixed],''),{
   firstperson_righthand:{rotation:[60,70,80],translation:[4,5,6],scale:[2,3,4]},
  },c);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const selector=item.model.cases.find(c=>c.when==='skin_arm').model;
  const hand=selector.cases.find(c=>c.when==='firstperson_righthand');
  const ordinary=modelNodes(hand.model).find(m=>m.type==='minecraft:model');
  const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/models/'+ordinary.model.split(':')[1]+'.json'));
  const transform=model.display.firstperson_righthand;
  expect(transform.rotation || [0,0,0]).toEqual([0,0,0]);
  expect(transform.translation || [0,0,0]).toEqual([0,0,0]);
  expect(transform.scale || [1,1,1]).toEqual([1,1,1]);
 });
 it('keeps mixed GUI geometry aligned after normalizing and quantizing display fields',async()=>{
  const {api,context,memfs}=setup(),gui={rotation:[375,-30,45],translation:[200,-200,.1],scale:[5,0,2],pivot:[200,-200,.125]};
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  const c={...cfg,scale:2,offset:[3,4,5],displaySlots:{gui},selectedContexts:SKIN_CONTEXTS};
  const mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  // buildDisplayTransforms intentionally omits gui: its ordinary renderer reads the PNG header.
  const display=api.buildDisplayTransforms(c);expect(display.gui).toBeUndefined();
  await api.saveSingleOutput(await api.buildOutput(c,[mixed],''),display,c);
  const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/native_profiles.json')).models.skin_arm;
  const q=(x,min,max)=>Math.round((x-min)/(max-min)*65535)/65535*(max-min)+min;
  // The PNG clamps scale/translation/pivot, replaces non-positive scale by 1,
  // wraps angles, and stores every value at q16 precision.
  const scales=[4,q(1,0,4),q(2,0,4)],translation=[128,-128,q(.1,-128,128)];
  const rotation=[15,330,45].map(x=>q(x,0,360)),pivot=[128,-128,q(5.25,-128,128)];
  const {PNG}=require('pngjs'),native=PNG.sync.read(Buffer.from(memfs.writes.get('/rp/assets/objcubed/textures/item/skin_arm_native.png')));
  const fields=[];for(let x=8;x<16;x++)fields.push(...native.data.subarray(x*4,x*4+3));
  const read=(i,min,max)=>(fields[i]*256+fields[i+1])/65535*(max-min)+min;
  expect([0,2,4].map(i=>read(i,0,4))).toEqual(scales);
  expect([6,8,10].map(i=>read(i,-128,128))).toEqual(translation);
  expect([12,14,16].map(i=>read(i,0,360))).toEqual(rotation);
  expect([18,20,22].map(i=>read(i,-128,128))).toEqual(pivot);
  const expected=api.buildItemTransformMatrix(rotation,translation,scales);
  for(let axis=0;axis<3;axis++)expected[12+axis]+=pivot[axis]-expected[axis]*pivot[0]-expected[4+axis]*pivot[1]-expected[8+axis]*pivot[2];
  const actual=model.transforms[model.contexts.indexOf('gui')];
  actual.forEach((value,i)=>expect(value).toBeCloseTo(expected[i],10));
 });
 it.each([false,true])('matches dropped-item CPU bounds with scale .3, mixed materials %s',async mixed=>{
  const {api,context,memfs}=setup();
  if(mixed)context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  const c={...cfg,selectedContexts:SKIN_CONTEXTS,displaySlots:{ground:{scale:[.3,.3,.3]}}};
  const out=await api.buildOutput(c,[mixed?OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4':OBJ],'');
  await api.saveSingleOutput(out,api.buildDisplayTransforms(c),c);
  // Ground carriers add 8 BB units before vanilla's -0.5 origin and display scale.
  const referenceMinY=Math.min(...out.elements.flatMap(e=>[e.from[1],e.to[1]]).map(y=>((y+8)/16-.5)*.3));
  expect(referenceMinY).toBeCloseTo(.15,10);
  const catalog=JSON.parse(memfs.writes.get('/rp/assets/objcubed/native_profiles.json')).models.skin_arm;
  const ground=catalog.contexts.indexOf('ground');
  expect(catalog.originShifts[ground]).toEqual([0,1.165625,0]);
  expect(catalog.modelLifts[ground]).toEqual([0,1,0]);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const entry=item.model.cases.find(c=>c.when==='skin_arm').model.cases.find(c=>c.when==='ground');
  const heads=modelNodes(entry.model).filter(m=>m.type==='minecraft:special');
  for(const head of heads) {
   const shift=head.transformation.translation[1];
   expect(shift).toBeCloseTo(1.165625,10);
   // Skull native minY=-.515625, then ItemTransform applies another -.5.
   const nativeMinY=shift-.515625-.5;
   expect(nativeMinY).toBeCloseTo(referenceMinY,10);
   expect(-nativeMinY+.0625).toBeCloseTo(-referenceMinY+.0625,10);
  }
 });
 it('calibrates an unselected ground context against neutral carrier bounds',async()=>{
  const {api,memfs}=setup(),c={...cfg,selectedContexts:['fixed'],displaySlots:{ground:{scale:[.3,.3,.3],translation:[0,5,0]}}};
  const out=await api.buildOutput(c,[OBJ],'');
  await api.saveSingleOutput(out,api.buildDisplayTransforms(c),c);
  const referenceMinY=Math.min(...out.elements.flatMap(e=>[e.from[1],e.to[1]]).map(y=>y/16-.5));
  expect(referenceMinY).toBe(0);
  const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/native_profiles.json')).models.skin_arm;
  const ground=model.contexts.indexOf('ground');
  expect(model.originShifts[ground]).toEqual([0,1.015625,0]);
  expect(model.modelLifts[ground]).toEqual([0,0,0]);
 });
 it('preserves a v1 hand-only catalog entry and item selector when adding a world-capable model',async()=>{
  const {api,memfs}=setup(),out=await api.buildOutput(cfg,[OBJ],'');
  const identity=JSON.parse(JSON.stringify(api.buildItemTransformMatrix([0,0,0],[0,0,0],[1,1,1])));
  const old={positions:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],uvs:[[0,0],[1,0],[1,1],[0,1]],vertices:[[0,0],[1,1],[2,2],[3,3]],
   faces:1,ordinaryFaces:0,frames:1,duration:20,autoplay:false,controlled:false,easing:0,visible:true,unlit:[0],
   start:101,count:2,chunks:1,states:1,transforms:[identity,identity]};
  const oldCase={when:'old_skin',model:{type:'minecraft:select',property:'minecraft:display_context',cases:[
   {when:'firstperson_righthand',model:{type:'minecraft:special',base:'objcubed:item/old_skin_skin_donor',model:{type:'minecraft:player_head'},
    transformation:{scale:[32+101/32,1,1/(8+101/32)],translation:[0,0,0],left_rotation:[0,0,0,1],right_rotation:[0,0,0,1]}}}],
   fallback:{type:'minecraft:model',model:'objcubed:item/old_skin_default'}}};
  const catalogPath='/rp/assets/objcubed/native_profiles.json';
  memfs.writes.set(catalogPath,JSON.stringify({version:1,models:{old_skin:old}}));
  memfs.writes.set('/rp/assets/minecraft/items/player_head.json',JSON.stringify({model:{type:'minecraft:select',property:'minecraft:custom_model_data',cases:[oldCase],
   fallback:{type:'minecraft:model',model:'minecraft:item/player_head'}}}));
  await api.saveSingleOutput(out,{},cfg);
  const catalog=JSON.parse(memfs.writes.get(catalogPath));
  expect(catalog.models.old_skin).toEqual(old);
  const current=catalog.models.skin_arm;
  expect(current.start+current.count<=old.start || current.start>=old.start+old.count).toBe(true);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  expect(item.model.cases.find(c=>c.when==='old_skin')).toEqual(oldCase);
  expect(memfs.writes.get('/rp/assets/objcubed/shaders/include/profile_geometry.glsl')).toMatch(/id\s*>=\s*101\s*&&\s*id\s*<\s*103/);
 });
 it('exports native first-person geometry and preserves other models on re-export',async()=>{
  const {api,memfs}=setup();
  const out=await api.buildOutput(cfg,[OBJ,OBJ.replace('v 1 1 0','v 1 2 0')],'');
  expect(out.nativeSkin.faces).toBe(1);expect(out.nativeSkin.frames).toBe(2);
  expect(out.rawBuf[(out.tw+5)*4]&32).toBe(32);
  expect(out.nativeSkin.uvs).toContainEqual([0,1]);
  await api.saveSingleOutput(out,{},cfg);
  const catalogPath='/rp/assets/objcubed/native_profiles.json';
  const original=JSON.parse(memfs.writes.get(catalogPath)).models.skin_arm;
  await api.saveSingleOutput(out,{}, {...cfg,cmdName:'second'});
  const second=JSON.parse(memfs.writes.get(catalogPath)).models.second;
  expect(second.start).toBeGreaterThanOrEqual(original.start+original.count);
  await api.saveSingleOutput(out,{firstperson_righthand:{rotation:[15,30,45],translation:[1,2,3],scale:[.5,2,3]}},cfg);
  const all=JSON.parse(memfs.writes.get(catalogPath)).models;
  expect(all.skin_arm.start).toBe(original.start);expect(all.second).toEqual(second);
  expect(all.skin_arm.transforms[0]).toEqual(api.buildItemTransformMatrix([15,30,45],[1,2,3],[.5,2,3]));
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  const hand=item.model.cases[0].model.cases.find(c=>c.when==='firstperson_righthand').model;
  expect(hand.models.filter(m=>m.type==='minecraft:special')).toHaveLength(1);
  expect(hand.models).toHaveLength(1); // no redundant encoded carrier for an all-profile model
  expect(hand.models[0].transformation.translation).toEqual([0,0,0]);
  const shader=memfs.writes.get('/rp/assets/objcubed/shaders/include/profile_geometry.glsl');
  expect(shader).toContain(`id>=${second.start} && id<${second.start+second.count}`);
  expect(shader.match(/vec3 ocp_\w+_p\(int i\)/g)).toHaveLength(1); // shared geometry table
 });
 it('mirrors command playback into the first float without replacing other CMD fields',async()=>{
  const {api}=setup();
  const out=await api.buildOutput({...cfg,generateDatapack:true,colorbehavior:['time','time','time']},[OBJ,OBJ],'');
  const files=api.generateDatapackFiles('wave',2,'objcubed','player','mainhand','player_head','skin_arm',null,'humanoid',true,[],out.nativeSkin);
  const auto=[...files].find(([p])=>p.endsWith('/_apply_auto.mcfunction'))[1];
  const manual=[...files].find(([p])=>p.endsWith('/_apply_manual.mcfunction'))[1];
  expect(auto).toContain('"minecraft:custom_model_data".floats[0] float 1');
  expect(auto).toContain('matches 32768..');
  expect(manual).toMatch(/players add #profile \S+ 3/);
  expect(auto.indexOf('.floats[0] float 1')).toBeLessThan(auto.indexOf('item replace entity @s'));
  expect(auto).not.toContain('"minecraft:custom_model_data" set value');
 });
 it('rejects an unknown native catalog before writing model files',async()=>{
  const {api,memfs}=setup();const out=await api.buildOutput(cfg,[OBJ],'');
  memfs.writes.set('/rp/assets/objcubed/native_profiles.json','{"version":99,"models":{}}');
  await expect(api.saveSingleOutput(out,{},cfg)).rejects.toThrow('catalog');
  expect(memfs.writes.size).toBe(1);
 });
 it.each([0,1,2,3,4,5,6,7])('encodes UV metadata for slot %s without reading a reference skin',async slot=>{
  const {api,decoded}=setup();const out=await api.buildOutput({...cfg,skinSlot:slot},[OBJ],'');
  expect(decoded()).toBe(0);expect(out.skinSlot).toBe(slot);
  expect(out.rawBuf[(64+5)*4]&64).toBe(64);
  const header=2+Math.ceil(out.nfaces/64);
  const pixels=Array.from(out.rawBuf.slice(header*64*4,(header+64)*64*4));
  expect(pixels.filter((_,i)=>i%4===2).every(x=>x===((253+slot)&255))).toBe(true);
  expect(new Set(pixels.filter((_,i)=>i%4===0)).size).toBe(64);
 });
 it('exports a composite, keeps other cases and emits binding even for static models',async()=>{
  const {api,memfs}=setup();const out=await api.buildOutput(cfg,[OBJ],'');
  memfs.writes.set('/rp/assets/minecraft/items/player_head.json',JSON.stringify(api.buildItemSelector('old',[],'player_head')));
  await api.saveSingleOutput(out,{},cfg);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  expect(item.model.cases.some(x=>x.when==='old')).toBe(true);
  const entry=item.model.cases.find(x=>x.when==='skin_arm').model;
  expect(JSON.stringify(entry)).toContain('minecraft:composite');
  expect(JSON.stringify(entry)).toContain('minecraft:player_head');
  expect(item.model.fallback.type).toBe('minecraft:special');
  const tick=memfs.writes.get('/dp/objcubed_skin/data/objcubed/function/skin/skin_arm/tick.mcfunction');
  expect(tick).toContain('minecraft:custom_model_data~{strings:["skin_arm"]}');
  expect(tick).toContain('weapon.offhand');
  expect(tick).toContain('fill_player_head');
  expect([...memfs.writes.values()].join('\n')).not.toContain('name:"Notch"');
 });
 it.each([{outputMode:'files'},{exportAsEquipment:true},{skinSlot:8},{skinSlot:-1},{skinSlot:1.5}])('rejects unsupported combination before files: %j',async extra=>{
  const {api,memfs}=setup();await expect(api.buildOutput({...cfg,...extra},[OBJ],'')).rejects.toThrow();
  expect(memfs.writes.size).toBe(0);
 });
 it.each([false,true])('exports only faces assigned the skin reference, with atlas toggle %s',async useAtlas=>{
  const {api,context,decoded}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  // A normal blue material deliberately matches the old UV-payload RGB range.
  context.document.createElement=()=>({getContext:()=>({drawImage(){},getImageData(){
   return {data:Uint8Array.from({length:64*64*4},(_,i)=>[17,23,253,255][i%4])};
  }})});
  const mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  const out=await api.buildOutput({...cfg,useAtlas,atlasTexIndices:[0]},[mixed,mixed],'');
  expect(decoded()).toBe(1); // decode paint, never the reference skin
  expect(out.rawBuf[(out.tw+5)*4]&192).toBe(192);
  const b=out.rawBuf,w=out.tw;
  const read24=at=>b[at]*65536+b[at+1]*256+b[at+2];
  const texH=b[1*4+2]*256+b[7*4],header=2+Math.ceil(out.nfaces/w);
  expect(texH).toBe(128);
  const vpH=b[5*4]*256+b[5*4+1],vtH=b[5*4+2]*256+b[7*4+2];
  const uvBase=header+texH+vpH,vertexBase=uvBase+vtH;
  // Each frame has the same per-face material flags, including shared source UVs.
  for(let frame=0;frame<2;frame++)for(let face=0;face<2;face++)for(let corner=0;corner<4;corner++){
   const vi=(frame*8+face*4+corner)*2+1;
   const ui=read24((vertexBase*w+vi)*4);
   expect(b[(uvBase*w+ui*2)*4]).toBe(face===0?1:0);
  }
  // The normal texture remains byte-identical, including its reserved-looking blue.
  expect(Array.from(b.slice((header+64)*w*4,(header+64)*w*4+4))).toEqual([17,23,253,255]);
 });
 it('keeps an ordinary animated strip independent of the profile atlas',async()=>{
  const {api,context}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:128,uv_width:64,uv_height:64,display_height:64,frameCount:2,source:'paint'});
  context.Image=class {set src(_){queueMicrotask(()=>this.onload());}get naturalWidth(){return 64;}get naturalHeight(){return 128;}};
  context.document.createElement=()=>({getContext:()=>({drawImage(){},getImageData(){return {data:new Uint8Array(64*128*4).fill(255)};}})});
  const mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  const out=await api.buildOutput({...cfg,texAnimEnabled:true,texFrametime:4,texFade:true},[mixed],'');
  expect(out.rawBuf[(out.tw+5)*4]&192).toBe(192);
  expect(out.rawBuf[(out.tw+5)*4+1]).toBe(1); // exactly one ordinary animation band
  expect(out.rawBuf[(out.tw+7)*4+1]).toBe(2); // both frames survive
 });
 it('uses native translucent materials and activates only the main pack fallback',async()=>{
  const {api,memfs}=setup();const out=await api.buildOutput(cfg,[OBJ],'');
  await api.saveSingleOutput(out,{},cfg);
  const model=JSON.parse(memfs.writes.get('/rp/assets/objcubed/models/item/skin_arm_default.json'));
  expect(model.textures['0']).toEqual({sprite:'objcubed:item/skin_arm',force_translucent:true});
  const post=JSON.parse(memfs.writes.get('/rp/assets/minecraft/post_effect/end_of_frame.json'));
  expect(post.passes.map(p=>p.fragment_shader)).toEqual(['objcubed:post/profile_resolve','objcubed:post/profile_copy']);
 });
 it('rejects a foreign post chain before writing models or textures',async()=>{
  const {api,memfs}=setup(),file='/rp/assets/minecraft/post_effect/end_of_frame.json';
  const foreign=JSON.stringify({passes:[{fragment_shader:'other:effect'}]});memfs.writes.set(file,foreign);
  const before=[...memfs.writes];
  await expect(api.saveSingleOutput(await api.buildOutput(cfg,[OBJ],''),{},cfg)).rejects.toThrow(/another.*effect/i);
  expect([...memfs.writes]).toEqual(before);
 });
 it.each(['objcubed_skin:post/resolve','objcubed:post/profile_resolve'])('upgrades or preserves our post chain %s',shader=>{
  const {api,memfs}=setup(),file='/rp/assets/minecraft/post_effect/end_of_frame.json';
  memfs.writes.set(file,JSON.stringify({passes:[{fragment_shader:shader}]}));
  api.installSkinRuntime(memfs,path.posix,'/rp');
  expect(JSON.parse(memfs.writes.get(file)).passes).toHaveLength(2);
  expect(memfs.writes.has(file+'.tmp')).toBe(false);
 });
 it('reports a reference texture that is not assigned to any face',async()=>{
  const {api,context}=setup();
  context.Texture.all.push({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  await expect(api.buildOutput(cfg,[OBJ.replace('m_u','m_paint')],'')).rejects.toThrow(/assign|assigned/i);
 });
 it('uses texture UUIDs when the skin reference and paint have the same filename',async()=>{
  const {api,context,decoded}=setup();
  context.Texture.all[0].name='shared.png';
  context.Texture.all.push({uuid:'paint',name:'shared.png',width:64,height:64,source:'paint'});
  const mixed=OBJ+'\nusemtl m_paint\nf 1/1 2/2 3/3 4/4';
  const out=await api.buildOutput(cfg,[mixed],'newmtl m_u\nmap_Kd shared.png\nnewmtl m_paint\nmap_Kd shared.png');
  expect(decoded()).toBe(1);
  expect(out.rawBuf[1*4+2]*256+out.rawBuf[7*4]).toBe(128);
 });
 it('automatically uses a tagged texture even after renaming/reordering and with skin disabled in old settings',async()=>{
  const {api,context,decoded}=setup();
  context.Texture.all.unshift({uuid:'paint',name:'paint',width:64,height:64,source:'paint'});
  Object.assign(context.Texture.all[1],{name:'renamed.png',objcubed_player_skin:true});
  const auto={...cfg,skinEnabled:false,texIndex:0};
  const out=await api.buildOutput(auto,[OBJ],'');
  expect(out.skinSlot).toBe(0);expect(decoded()).toBe(0);
  expect(auto.texIndex).toBe(1);expect(auto.skinFromTexture).toBe(true);
 });
 it('does not keep replacing a regular texture after the special texture is removed',async()=>{
  const {api,decoded}=setup();
  const out=await api.buildOutput({...cfg,skinFromTexture:true},[OBJ],'');
  expect(out.skinSlot).toBe(null);expect(decoded()).toBe(1);
 });
 it('reports duplicate special textures rather than silently choosing one',async()=>{
  const {api,context}=setup();context.Texture.all[0].objcubed_player_skin=true;
  context.Texture.all.push({...context.Texture.all[0],uuid:'another'});
  await expect(api.buildOutput({...cfg,skinEnabled:false},[OBJ],'')).rejects.toThrow(/one.*skin|skin.*one/i);
 });
 it('adds the template to both texture context menus, preserves faces and removes its actions on unload',()=>{
  const {api,context}=setup();const edits=[];
  const menu=()=>({structure:[],addAction(a){this.structure.push(a);},removeAction(id){this.structure=this.structure.filter(a=>a.id!==id);}});
  class Texture {
   static all=[];
   constructor(data){Object.assign(this,data);}
   fromDataURL(source){this.source=source;return this;}
   add(){Texture.all.push(this);return this;}
   select(){Texture.selected=this;return this;}
  }
  Texture.prototype.menu=menu();
  Object.assign(context,{Texture,Interface:{Panels:{textures:{menu:menu()}}},
   Action:class {constructor(id,o){Object.assign(this,o,{id});}delete(){this.deleted=true;}},
   Property:class {constructor(cls,type,name,options){Object.assign(this,{cls,type,name,options});}delete(){this.deleted=true;}},
   Undo:{initEdit(x){edits.push(x);},finishEdit(name,x){edits.push(x);}}});
  const owner={};api.installSkinTextureTools(owner);
  const action=context.Interface.Panels.textures.menu.structure[0];
  expect(Texture.prototype.menu.structure).toContain(action);
  expect(action.children.map(c=>c.name).join(' ')).toMatch(/Steve.*Alex/);
  action.children[1].click();action.children[1].click();
  expect(Texture.all).toHaveLength(1);expect(edits).toHaveLength(2);
  const texture=Texture.all[0];
  expect(texture.name).toContain('Alex');
  expect(Buffer.from(texture.source.split(',')[1],'base64')).toEqual(require('node:fs').readFileSync(new URL('../fixtures/skin-reference/alex.png',import.meta.url)));
  expect(texture.objcubed_player_skin).toBe(true);expect(Texture.selected).toBe(texture);
  const {PNG}=require('pngjs');const img=PNG.sync.read(Buffer.from(texture.source.split(',')[1],'base64'));
  expect([img.width,img.height]).toEqual([64,64]);
  expect(edits[0]).toEqual({textures:[],selected_texture:true});
  expect(edits[1].textures[0]).toBe(texture);
  expect(owner.skinTextureProperty.name).toBe('objcubed_player_skin');
  api.uninstallSkinTextureTools(owner);
  expect(context.Interface.Panels.textures.menu.structure).toHaveLength(0);
  expect(Texture.prototype.menu.structure).toHaveLength(0);expect(action.deleted).toBe(true);
 });
 it.each(['steve','alex'])('embeds the supplied Blockbench %s reference without changing its bytes',variant=>{
  const {api}=setup();
  expect(api.skinReferenceImage(variant)).toEqual(require('node:fs').readFileSync(new URL(`../fixtures/skin-reference/${variant}.png`,import.meta.url)));
 });
 it('keeps both binding functions and the native fallback across subsequent exports',async()=>{
  const {api,memfs}=setup();
  for(const cmdName of ['skin_arm','second']) {
   const c={...cfg,cmdName};
   await api.saveSingleOutput(await api.buildOutput(c,[OBJ],''),{},c);
  }
  const tag=JSON.parse(memfs.writes.get('/dp/objcubed_skin/data/objcubed/tags/function/skin/bind.json'));
  expect(tag.values).toEqual(['objcubed:skin/skin_arm/tick','objcubed:skin/second/tick']);
  const ordinary={...cfg,skinEnabled:false,baseItem:'player_head',cmdName:'ordinary'};
  await api.saveSingleOutput(await api.buildOutput(ordinary,[OBJ],''),{},ordinary);
  const item=JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/player_head.json'));
  expect(item.model.cases.map(c=>c.when)).toEqual(['skin_arm','second','ordinary']);
  expect(item.model.fallback.model.type).toBe('minecraft:player_head');
  expect(JSON.stringify(item.model.cases[0])).toContain('minecraft:composite');
 });
 it('leaves ordinary encoded textures unmarked',async()=>{
  const {api,decoded}=setup();const out=await api.buildOutput({...cfg,skinEnabled:false},[OBJ],'');
  expect(decoded()).toBe(1);expect(out.rawBuf[(64+5)*4]&64).toBe(0);
 });
});
