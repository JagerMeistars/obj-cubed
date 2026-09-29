import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadObjcubedWithContext}=require('../helpers/load-plugin.cjs');
const {loadColorPlugin}=require('../helpers/color-plugin.cjs');
const {makeMemFs}=require('../helpers/mem-fs.cjs');
const path=require('node:path').posix;
const {PNG}=require('pngjs');

const TARGETS=[
  ['horse_body','body','leather_horse_armor',0],
  ['horse_saddle','saddle','saddle',1],
];
function result(nfaces=7,tw=24){
  const ty=4,rawBuf=Buffer.alloc(tw*ty*4,37);
  rawBuf.set([12,34,56,255]);
  return {rawBuf,pngBuffer:PNG.sync.write({width:tw,height:ty,data:rawBuf}),
    tw,ty,nfaces,nvertices:nfaces*4,nframes:1,elements:[],
    faceGroups:Array.from({length:nfaces},(_,i)=>`ocp3e${i%16}i${i}`),
    faceEmission:Array.from({length:nfaces},(_,i)=>i%16),
    faceToPart:Array(nfaces).fill(2)};
}
function setup(){
  const memfs=makeMemFs();
  const {api}=loadObjcubedWithContext({globals:{
    Buffer,Blockbench:{export(){throw new Error('unexpected dialog');},pickDirectory(){return '/rp';}},
    Project:{name:'horse_model',export_path:''},BarItems:{},Outliner:{root:[],elements:[]},
    console:{log(){},warn(){},error(){}},
  },requireImpl:id=>id==='fs'?memfs:id==='path'?path:require(id)});
  return {api,memfs};
}
const config=equipmentTarget=>({resourcePackDir:'/rp',baseItem:'iron_ingot',cmdName:'horse_model',
  exportAsEquipment:true,equipmentTarget,equipmentSlot:'right_arm',selectedPieces:['chestplate'],
  generateDatapack:false});

describe('horse equipment target packaging',()=>{
  it.each(TARGETS)('%s writes six-face layers, preserves the plain item, and ignores retained humanoid selection',async(target,slot,item,type)=>{
    const {api,memfs}=setup(),r=result(),cfg=config(target);
    const original=Buffer.from(r.rawBuf);
    await api.saveSingleOutput(r,{},cfg);
    const name=`horse_model_${target}`;
    const defPath=`/rp/assets/minecraft/equipment/${name}.json`;
    expect(memfs.writes.has(defPath)).toBe(true);
    const def=JSON.parse(memfs.writes.get(defPath));
    expect(Object.keys(def.layers)).toEqual([target]);
    expect(def.layers[target]).toHaveLength(2);
    for(let layer=0;layer<2;layer++){
      expect(def.layers[target][layer]).toEqual({texture:`minecraft:${name}_${layer}`,dyeable:{color_when_undyed:16777215}});
      const png=PNG.sync.read(Buffer.from(memfs.writes.get(`/rp/assets/minecraft/textures/entity/equipment/${target}/${name}_${layer}.png`)));
      expect([...png.data.subarray(0,4)]).toEqual([12,34,56,252]);
      for(let face=0;face<6;face++){
        const offset=(8+face)*4,k=6*layer+face,valid=k<7;
        expect(png.data[offset]*256+png.data[offset+1]).toBe(valid?k:65535);
        expect(png.data[offset+2]).toBe(valid?k:0);
      }
      expect(png.data[8*4+3]).toBe(1);
      expect(png.data[9*4+3]).toBe(type);
      expect([...png.data.subarray(14*4)]).toEqual([...original.subarray(14*4)]);
    }
    expect(r.rawBuf).toEqual(original);
    expect(cfg.selectedPieces).toEqual(['chestplate']);
    expect(cfg.equipmentSlot).toBe('right_arm');
    expect(cfg.baseItem).toBe('iron_ingot');
    expect([...memfs.writes.keys()].some(p=>p.includes('/equipment/humanoid/'))).toBe(false);
    const itemPng=memfs.writes.get('/rp/assets/objcubed/textures/item/horse_model.png');
    expect(PNG.sync.read(Buffer.from(itemPng)).data[3]).toBe(255);
    const give=memfs.writes.get(`/rp/assets/minecraft/equipment/${name}_give.txt`);
    expect(give).toContain(`minecraft:${item}[`);
    expect(give).toContain(`slot:"${slot}"`);
    expect(give).toContain(`asset_id:"minecraft:${name}"`);
    expect(give).toContain('allowed_entities:["minecraft:horse"]');
    expect(give).toContain('minecraft:custom_model_data={strings:["horse_model"]}');
    expect(give).toContain('damage_on_hurt:false');
    expect(give).toContain('equip_on_interact:true');
    expect(give).toContain('equip_sound:"minecraft:intentionally_empty"');
    const itemGive=memfs.writes.get(`/rp/assets/minecraft/items/${item}_give.txt`);
    expect(itemGive.trim()).toBe(give.trim());
    expect(memfs.writes.has(`/rp/assets/minecraft/items/${item}.json`)).toBe(true);
    const selector=JSON.parse(memfs.writes.get(`/rp/assets/minecraft/items/${item}.json`));
    expect(selector.model.cases.some(c=>c.when==='horse_model')).toBe(true);
    expect(selector.model.fallback.model).toBe(`minecraft:item/${item}`);
  });

  it.each(TARGETS)('%s appends its give command once while preserving manual content',async target=>{
    const {api,memfs}=setup();
    const file=`/rp/assets/minecraft/equipment/horse_model_${target}_give.txt`;
    const manual='# rider notes\r\ngive @s minecraft:apple';
    memfs.writes.set(file,manual);
    await api.saveSingleOutput(result(),{},config(target));
    const first=memfs.writes.get(file);
    expect(first.startsWith(manual+'\r\n')).toBe(true);
    expect(first.split(/\r?\n/).filter(s=>s.includes(`asset_id:"minecraft:horse_model_${target}"`))).toHaveLength(1);
    await api.saveSingleOutput(result(),{},config(target));
    expect(memfs.writes.get(file)).toBe(first);
  });

  it('preserves the native saddle removal-with-shears behavior when overriding equippable',async()=>{
    const {api,memfs}=setup();
    await api.saveSingleOutput(result(),{},config('horse_saddle'));
    const give=memfs.writes.get('/rp/assets/minecraft/equipment/horse_model_horse_saddle_give.txt');
    expect(give).toContain('can_be_sheared:true');
    expect(give).toContain('shearing_sound:"minecraft:item.saddle.unequip"');
  });

  it.each(TARGETS)('%s supports a 16px header while preserving all row-1 bytes',async target=>{
    const {api,memfs}=setup(),r=result(1,16),cfg=config(target);
    await api.saveSingleOutput(r,{},cfg);
    const p=`/rp/assets/minecraft/textures/entity/equipment/${target}/horse_model_${target}_0.png`;
    const png=PNG.sync.read(Buffer.from(memfs.writes.get(p)));
    expect([...png.data.subarray(16*4)]).toEqual([...r.rawBuf.subarray(16*4)]);
  });

  it.each([['narrow',15,1,/16px/],['overflow',16,65536,/65535/]])('rejects a %s horse header or face table before writing equipment PNGs',async(_label,width,nfaces,error)=>{
    const {api,memfs}=setup(),r=result(1,width);r.nfaces=nfaces;
    await expect(api.saveSingleOutput(r,{},config('horse_body'))).rejects.toThrow(error);
    expect([...memfs.writes.keys()].some(p=>p.includes('/textures/entity/equipment/'))).toBe(false);
  });

  it.each(TARGETS)('%s datapack targets the horse slot and dye channel, despite retained humanoid defaults',async(target,slot,item)=>{
    const {api,memfs}=setup(),r=result();r.nframes=3;
    await api.saveSingleOutput(r,{}, {...config(target),generateDatapack:true,
      datapackOutputDir:'/dp',datapackNamespace:'horse_test',datapackAnimId:'walk',
      datapackTargetType:'equipment',datapackEquipSlot:'chest'});
    const prefix='/dp/objcubed/data/horse_test/function/walk';
    const summon=memfs.writes.get(`${prefix}/summon.mcfunction`);
    expect(summon).toContain('summon horse ');
    expect(summon).toContain(item);
    expect(summon).toContain(`minecraft:horse_model_${target}`);
    const manual=memfs.writes.get(`${prefix}/zzz/_apply_manual.mcfunction`);
    expect(manual).toContain(`equipment.${slot}.components."minecraft:dyed_color"`);
    expect(manual).not.toContain('potion_contents');
    const auto=memfs.writes.get(`${prefix}/zzz/_apply_auto.mcfunction`);
    expect(auto).toContain(`equipment.${slot}.components."minecraft:dyed_color"`);
  });
});

describe('horse geometry origin',()=>{
  it.each(TARGETS)('%s keeps item-space geometry and offsets without humanoid part recentering',async target=>{
    const white=new Uint8Array(16*16*4).fill(255);
    class Image {
      set src(_value){queueMicrotask(()=>this.onload());}
      get naturalWidth(){return 16;}
      get naturalHeight(){return 16;}
    }
    const {api}=loadObjcubedWithContext({globals:{Buffer,Image,
      console:{log(){},warn(){},error(){}},Outliner:{root:[],elements:[]},
      Texture:{all:[{uuid:'t',source:'data:test'}]},
      document:{createElement(){return{getContext(){return{drawImage(){},getImageData(){return{data:white,width:16,height:16};}};}};}},
    }});
    const obj=['v 3 5 7','v 4 5 7','v 4 6 7','v 3 6 7',
      'vt 0 0','vt 1 0','vt 1 1','vt 0 1','o ocp3e7i0','usemtl m_t','f 1/1 2/2 3/3 4/4'].join('\n');
    const cfg={texIndex:0,useAtlas:false,texAnimEnabled:false,nopow:false,scale:1,offset:[1,2,3],
      colorbehavior:['direct','direct','direct'],duration:0,autoplay:false,easing:0,interpolation:0,
      noshadow:false,autorotate:3,visibility:7,displaySlots:{},flipuv:false};
    const item=await api.buildOutput(cfg,[obj],'');
    const horse=await api.buildOutput({...cfg,exportAsEquipment:true,equipmentTarget:target,
      selectedPieces:['chestplate'],equipmentSlot:'right_arm'},[obj],'');
    expect(horse.rawBuf).toEqual(item.rawBuf);
    expect(horse.faceEmission).toEqual([7]);
  });
});

describe('horse target settings preserve humanoid choices',()=>{
  it('defaults old and new projects to humanoid',()=>{
    expect(loadColorPlugin().openDialog().equipmentTarget).toBe('humanoid');
    const legacy=loadColorPlugin({persisted:{exportAsEquipment:true,equipmentSlot:'left_arm',selectedPieces:['helmet']}}).openDialog();
    expect(legacy.equipmentTarget).toBe('humanoid');
    expect(legacy.equipmentSlot).toBe('left_arm');
    expect(legacy.selectedPieces).toEqual(['helmet']);
  });
  it.each(['unsupported_animal_body','__proto__',null,17])('normalizes an unknown persisted target %s to humanoid',equipmentTarget=>{
    const state=loadColorPlugin({persisted:{equipmentTarget,equipmentSlot:'left_arm',selectedPieces:['helmet']}}).openDialog();
    expect(state.equipmentTarget).toBe('humanoid');
    expect(state.equipmentSlot).toBe('left_arm');
    expect(state.selectedPieces).toEqual(['helmet']);
  });
  it.each(TARGETS)('persists %s and passes it to export without clearing saved humanoid settings',async target=>{
    const p=loadColorPlugin({persisted:{equipmentSlot:'left_arm',selectedPieces:['helmet']}});
    let cfg;p.api.setExportSink(async value=>{cfg=value;});
    const state=p.openDialog();
    state.exportAsEquipment=true;state.equipmentTarget=target;
    await state.doExport();
    expect(cfg.equipmentTarget).toBe(target);
    const reopened=p.openDialog();
    expect(reopened.equipmentTarget).toBe(target);
    expect(reopened.equipmentSlot).toBe('left_arm');
    expect(reopened.selectedPieces).toEqual(['helmet']);
    reopened.equipmentTarget='humanoid';
    expect(reopened.selectedPieces).toEqual(['helmet']);
  });
  it('horse datapack export leaves saved human target, slot and base item intact',async()=>{
    const p=loadColorPlugin({persisted:{baseItem:'stick',datapackTargetType:'player',datapackEquipSlot:'head',
      equipmentSlot:'left_arm',selectedPieces:['helmet'],animationEnabled:true}});
    let cfg;p.api.setExportSink(async value=>{cfg=value;});
    const state=p.openDialog();
    state.exportAsEquipment=true;state.equipmentTarget='horse_saddle';state.generateDatapack=true;
    await state.doExport();
    expect(cfg.equipmentTarget).toBe('horse_saddle');
    const reopened=p.openDialog();
    expect(reopened.baseItem).toBe('stick');
    expect(reopened.datapackTargetType).toBe('player');
    expect(reopened.datapackEquipSlot).toBe('head');
    expect(reopened.equipmentSlot).toBe('left_arm');
    expect(reopened.selectedPieces).toEqual(['helmet']);
  });
});
