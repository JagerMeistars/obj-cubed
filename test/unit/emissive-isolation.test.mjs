import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {loadObjcubedWithContext} = require('../helpers/load-plugin.cjs');
const {makeMemFs} = require('../helpers/mem-fs.cjs');
const path = require('node:path').posix;

function fixture(specs, {failCompile = false} = {}) {
  class Cube {
    constructor({name, emission = 0}) {
      Object.assign(this, {name, type:'cube', objcubed_light_emission:emission, parent:'root'});
    }
  }
  class Mesh {
    constructor({name, emission = 0}) {
      Object.assign(this, {name, type:'mesh', objcubed_light_emission:emission, parent:'root'});
    }
  }
  const cubes = specs.map(spec => new (spec.type === 'mesh' ? Mesh : Cube)(spec));
  const fs = makeMemFs();
  let registration, action, component;
  const capture = new Error('capture editor constructor');
  class Image {
    set src(_value) { setTimeout(() => this.onload(), 0); }
    get naturalWidth() { return 16; }
    get naturalHeight() { return 16; }
    get width() { return 16; }
    get height() { return 16; }
  }
  const canvasContext = {
    drawImage() {},
    getImageData() { return {data:new Uint8Array(16*16*4).fill(255), width:16, height:16}; },
  };
  loadObjcubedWithContext({globals:{
    Buffer, setTimeout, Image, Cube, Mesh,
    console:{log(){},warn(){},error(){}},
    Project:{name:'fixture', export_path:''}, BarItems:{},
    Texture:{all:[{uuid:'u', name:'texture', source:'data:test', img:{src:'data:test'}}]},
    Animation:{all:[]}, Outliner:{root:[...cubes], elements:cubes},
    document:{createElement(){return {getContext(){return canvasContext;}};}},
    BBPlugin:{register(_id, options){registration=options;}},
    Blockbench:{},
    Action:class {constructor(_id, options){action=options; throw capture;}},
    Dialog:class {constructor(options){component=options.component; throw capture;}},
    Codecs:{obj:{compile(){
      if (failCompile) throw new Error('OBJ codec failed');
      // The official Blockbench 5.2.1 OBJ codec writes `o element.name` for
      // Cube and Mesh (obj.js:59,145). Its scene traversal order need not match
      // Outliner.elements, so deliberately export in the opposite order here.
      const obj = [...cubes].reverse().map((cube, i) => {
        const b=i*4;
        return [`o ${cube.name}`, 'v 0 0 0','v 1 0 0','v 1 1 0','v 0 1 0',
          'vt 0 0','vt 1 0','vt 1 1','vt 0 1','usemtl m_u',
          `f ${b+1}/${b+1} ${b+2}/${b+2} ${b+3}/${b+3} ${b+4}/${b+4}`].join('\n');
      }).join('\n');
      return {obj, mtl:''};
    }}},
  },requireImpl:id=>id==='fs'?fs:id==='path'?path:require(id)});
  expect(()=>registration.onload()).toThrow(capture);
  expect(()=>action.click()).toThrow(capture);
  const state=component.data();
  Object.assign(state, component.methods, {resourcePackDir:'/rp', durationTicksAuto:0});
  return {cubes, state, fs, async export(){
    await state.doExport();
    expect(state.statusKind, state.status).toBe('done');
    return JSON.parse(fs.writes.get('/rp/assets/objcubed/models/item/fixture_default.json'));
  }};
}

describe('emissive isolation through item export',()=>{
  it.each([
    ['duplicate default names', [{name:'cube',emission:15},{name:'cube',emission:0}], [0,15]],
    ['case-colliding names', [{name:'Cube',emission:15},{name:'cube',emission:0}], [0,15]],
    ['different emission levels on duplicate names', [{name:'cube',emission:5},{name:'cube',emission:12}], [12,5]],
    ['valid Minecraft light levels', [{name:'cube',emission:99},{name:'cube',emission:3.5}], [4,15]],
    ['cube and mesh sharing a name', [{name:'cube',emission:15},{name:'cube',type:'mesh'}], [0,15]],
    ['mesh and cube sharing a name', [{name:'cube',emission:15,type:'mesh'},{name:'cube'}], [0,15]],
  ])('%s retain each element\'s own light level',async(_label,specs,expected)=>{
    const f=fixture(specs);
    const model=await f.export();
    expect(model.elements.map(el=>el.light_emission||0)).toEqual(expected);
    expect(f.cubes.map(cube=>cube.name)).toEqual(specs.map(spec=>spec.name));
  });

  it('repeated ON/OFF exports update only the selected element and do not retain old emission',async()=>{
    const f=fixture([{name:'cube'},{name:'cube'}]);
    for (const [first,second,expected] of [
      [0,0,[0,0]], [15,0,[0,15]], [0,0,[0,0]], [0,15,[15,0]], [0,15,[15,0]],
    ]) {
      f.cubes[0].objcubed_light_emission=first;
      f.cubes[1].objcubed_light_emission=second;
      const model=await f.export();
      expect(model.elements.map(el=>el.light_emission||0)).toEqual(expected);
      expect(f.cubes.map(cube=>cube.name)).toEqual(['cube','cube']);
    }
  });

  it.each(['lamp_e','emissive_lamp'])('preserves the existing %s name convention',async name=>{
    const f=fixture([{name},{name:'plain'}]);
    const model=await f.export();
    expect(model.elements.map(el=>el.light_emission||0)).toEqual([0,15]);
    expect(f.cubes.map(cube=>cube.name)).toEqual([name,'plain']);
  });

  it('restores original names if the OBJ codec fails',async()=>{
    const f=fixture([{name:'cube',emission:15},{name:'cube'}],{failCompile:true});
    await f.state.doExport();
    expect(f.state.statusKind).toBe('error');
    expect(f.state.status).toContain('OBJ codec failed');
    expect(f.cubes.map(cube=>cube.name)).toEqual(['cube','cube']);
    expect(f.state.running).toBe(false);
  });
});
