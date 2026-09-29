import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { loadColorPlugin } = require('../helpers/color-plugin.cjs');
const { makeMemFs } = require('../helpers/mem-fs.cjs');
const path = require('node:path').posix;
const { PNG } = require('pngjs');
const fs = require('node:fs');
const vm = require('node:vm');

const TARGETS = ['horse_body', 'horse_saddle', 'donkey_saddle', 'mule_saddle',
  'zombie_horse_saddle', 'skeleton_horse_saddle', 'wolf_body', 'llama_body',
  'happy_ghast_body', 'wings', 'camel_saddle', 'camel_husk_saddle', 'pig_saddle',
  'strider_saddle', 'nautilus_body', 'nautilus_saddle'];

function setup(groups = []) {
  const memfs = makeMemFs();
  const { api, context } = loadObjcubedWithContext({
    globals: {
      Buffer, Group: { all: groups },
      Blockbench: { export() { throw Error('Unexpected export dialog'); } },
      Project: { name: 'animal_model', export_path: '' }, BarItems: {},
      Outliner: { root: groups, elements: [] },
      console: { log() {}, warn() {}, error() {} },
    },
    requireImpl: id => id === 'fs' ? memfs : id === 'path' ? path : require(id),
  });
  return { api, context, memfs };
}

function exportResult(bindings, tw = 16) {
  const ty = 8, rawBuf = Buffer.alloc(tw * ty * 4, 37);
  rawBuf.set([12, 34, 56, 255]);
  return { rawBuf, pngBuffer: PNG.sync.write({ width: tw, height: ty, data: rawBuf }),
    tw, ty, nfaces: bindings.length, nvertices: bindings.length * 4,
    nframes: 1, elements: [], faceToEquipmentBinding: bindings,
    faceEmission: bindings.map((_, i) => i % 16),
    faceGroups: bindings.map((_, i) => `ocp0e${i % 16}i${i}`),
    faceToPart: null,
  };
}

function exportConfig(equipmentTarget) {
  return { resourcePackDir: '/rp', cmdName: 'animal_model', baseItem: 'stick',
    exportAsEquipment: true, equipmentTarget, equipmentSlot: 'left_arm',
    selectedPieces: ['helmet'], generateDatapack: false };
}

function equipmentPngs(memfs, target) {
  return [...memfs.writes].filter(([name]) =>
    name.startsWith(`/rp/assets/minecraft/textures/entity/equipment/${target}/`) && name.endsWith('.png'))
    .map(([name, bytes]) => ({ name, png: PNG.sync.read(Buffer.from(bytes)) }));
}

function mappedFaces(png) {
  return Array.from({ length: 6 }, (_, i) => png.data[(8 + i) * 4] * 256 + png.data[(8 + i) * 4 + 1])
    .filter(index => index !== 65535);
}

it.each(['camel_saddle', 'camel_husk_saddle'])('packs rider-only %s reins into two active carrier faces', async target => {
  const { api, memfs } = setup();
  const carrier = api.EQUIPMENT_CARRIERS[target].bindings.reins;
  expect(carrier).toMatchObject({ cubeIndex: 1, visibleWhen: 'ridden' });
  expect(carrier.quads).toHaveLength(2);
  const result = exportResult(Array.from({ length: 5 }, () =>
    ({ part: 'reins', pivot: [1, 2, 3], key: 'reins' })));
  const original = Buffer.from(result.rawBuf), cfg = exportConfig(target);
  expect(api.planAnimalLayers(result, cfg).map(l => l.faces)).toEqual([[0, 1], [2, 3], [4]]);
  await api.saveSingleOutput(result, api.buildDisplayTransforms(cfg), cfg);
  const layers = equipmentPngs(memfs, target);
  expect(layers.map(({ png }) => mappedFaces(png))).toEqual([[0, 1], [2, 3], [4]]);
  for (const { png } of layers) {
    const base = result.ty * result.tw * 4;
    expect([...png.data.subarray(base + 32 * 4, base + 96 * 4)].every(v => v === 0)).toBe(true);
    expect([96, 97, 98].map(i => png.data.readFloatLE(base + i * 4))).toEqual([1, -2, 3]);
  }
  expect(result.rawBuf).toEqual(original);
});

function persistenceFixture(groups) {
  const handlers = new Map(), timers = [];
  const code = fs.readFileSync(new URL('../../objcubed.js', import.meta.url), 'utf8')
    .replace('module.exports.__test = {',
      'module.exports.__test = { installProjectPersistence, uninstallProjectPersistence, getObjContents,');
  const mod = { exports: {} };
  const context = {
    require, module: mod, exports: mod.exports, console,
    BBPlugin: { register() {} }, Plugin: { register() {} },
    settings: { language: { value: 'en' } }, Group: { all: groups },
    Project: { uuid: 'original-project' },
    Codecs: { project: {
      on(name, callback) { handlers.set(name, callback); },
      removeListener(name, callback) { if (handlers.get(name) === callback) handlers.delete(name); },
    } },
    setTimeout(callback) { const timer = { callback, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.active = false; },
  };
  context.globalThis = context;
  vm.runInNewContext(code, context, { filename: 'objcubed.js' });
  const api = mod.exports.__test;
  api.installProjectPersistence();
  return { api, context, handlers,
    flush() { for (const timer of timers.splice(0)) if (timer.active) timer.callback(); },
  };
}

it.each(['camel_saddle', 'camel_husk_saddle'])('exports %s ears as separate attachment groups', async target => {
  const groups = ['left_ear', 'right_ear'].map((part, i) =>
    ({ uuid: part, origin: [i * 16, 24, -16], objcubed_equipment_part: part }));
  const { api, memfs } = setup(groups), cfg = exportConfig(target);
  expect(api.collectEquipmentPartTags()).toEqual({ left_ear: 'left_ear', right_ear: 'right_ear' });
  const bindings = groups.map(parent => api.equipmentBindingOfElement({ parent }, cfg));
  for (const binding of bindings) {
    const carrier = api.EQUIPMENT_CARRIERS[target].bindings[binding.part];
    expect(carrier.path).toBe('root/body/head/' + binding.part);
    expect(carrier.quads).toHaveLength(6);
  }
  const result = exportResult(bindings.flatMap(b => Array(7).fill(b)));
  expect(api.planAnimalLayers(result, cfg).map(l => [l.part, l.faces.length]))
    .toEqual([['left_ear', 6], ['left_ear', 1], ['right_ear', 6], ['right_ear', 1]]);
  await api.saveSingleOutput(result, api.buildDisplayTransforms(cfg), cfg);
  expect(equipmentPngs(memfs, target).map(({ png }) => mappedFaces(png)))
    .toEqual([[0, 1, 2, 3, 4, 5], [6], [7, 8, 9, 10, 11, 12], [13]]);
});

describe('animal equipment tags remain separate from humanoid tags', () => {
  it('collects explicit string roles by UUID without replacing existing humanoid tags', () => {
    const groups = [
      { uuid: 'g-body', objcubed_equipment_part: 'body', objcubed_body_part: 8 },
      { uuid: 'g-head', objcubed_equipment_part: 'head', objcubed_body_part: 1 },
      { uuid: 'g-empty', objcubed_equipment_part: '', objcubed_body_part: 2 },
    ];
    const { api } = setup(groups);
    expect(api.collectEquipmentPartTags()).toEqual({ 'g-body': 'body', 'g-head': 'head' });
    expect(api.collectBodyPartTags()).toEqual({ 'g-body': 8, 'g-head': 1, 'g-empty': 2 });
  });

  it('reapplies valid roles and explicit clearing while ignoring malformed persisted values', () => {
    const groups = [
      { uuid: 'a', objcubed_equipment_part: '', objcubed_body_part: 3 },
      { uuid: 'b', objcubed_equipment_part: 'head', objcubed_body_part: 1 },
      { uuid: 'c', objcubed_equipment_part: 'body', objcubed_body_part: 0 },
      { uuid: 'd', objcubed_equipment_part: 'body', objcubed_body_part: 0 },
    ];
    const { api } = setup(groups);
    api.applyEquipmentPartTags({ a: 'head', b: '', c: 1.5, d: { part: 'head' }, absent: 'body' });
    expect(groups.map(g => g.objcubed_equipment_part)).toEqual(['head', '', 'body', 'body']);
    expect(groups.map(g => g.objcubed_body_part)).toEqual([3, 1, 0, 0]);
  });

  it('does not accept fractional humanoid IDs that produce an invalid OBJ name token', () => {
    const groups = [{ uuid: 'a', objcubed_body_part: -1 }];
    const { api } = setup(groups);
    api.applyBodyPartTags({ a: 1.5 });
    expect(groups[0].objcubed_body_part).toBe(-1);
    expect(api.collectBodyPartTags()).toEqual({});
  });
});

describe('animal target settings restore without clearing humanoid configuration', () => {
  it.each(TARGETS)('restores %s as a supported target', target => {
    const state = loadColorPlugin({ persisted: {
      exportAsEquipment: true, equipmentTarget: target,
      equipmentSlot: 'left_arm', selectedPieces: ['helmet'], baseItem: 'stick',
    } }).openDialog();
    expect(state.equipmentTarget).toBe(target);
    expect(state.equipmentSlot).toBe('left_arm');
    expect(state.selectedPieces).toEqual(['helmet']);
    expect(state.baseItem).toBe('stick');
  });
});

describe('animal tag project codec persistence', () => {
  it('round-trips the independent UUID map beside unchanged humanoid tags', () => {
    const groups = [
      { uuid: 'zero-pivot', origin: [0, 0, 0], objcubed_equipment_part: 'head', objcubed_body_part: 8 },
      { uuid: 'body', origin: [16, 32, 0], objcubed_equipment_part: 'body', objcubed_body_part: 0 },
    ];
    const f = persistenceFixture(groups), compiled = { model: {} };
    f.handlers.get('compile')(compiled);
    const saved = JSON.parse(JSON.stringify(compiled.model));
    expect(saved.objcubed.equipmentPartTags).toEqual({ 'zero-pivot': 'head', body: 'body' });
    expect(saved.objcubed.bodyPartTags).toEqual({ 'zero-pivot': 8, body: 0 });
    groups.forEach(group => { group.objcubed_equipment_part = ''; group.objcubed_body_part = -1; });
    f.context.Project = { uuid: 'reopened-project' };
    f.handlers.get('parse')({ model: saved });
    expect(groups.map(g => g.objcubed_equipment_part)).toEqual(['', '']);
    f.flush();
    expect(groups.map(g => g.objcubed_equipment_part)).toEqual(['head', 'body']);
    expect(groups.map(g => g.objcubed_body_part)).toEqual([8, 0]);
    expect(groups[0].origin).toEqual([0, 0, 0]);
  });

  it('saves equipment-only tags even when the dialog has never stored any settings', () => {
    const f = persistenceFixture([{ uuid: 'tag-only', objcubed_equipment_part: 'head' }]);
    const compiled = { model: {} };
    f.handlers.get('compile')(compiled);
    expect(compiled.model.objcubed?.equipmentPartTags).toEqual({ 'tag-only': 'head' });
  });

  it('does not apply delayed tags to another project or after plugin unload', () => {
    const group = { uuid: 'same-uuid', objcubed_equipment_part: '' };
    const f = persistenceFixture([group]);
    const event = { model: { objcubed: { version: 1, settings: {},
      equipmentPartTags: { 'same-uuid': 'head' } } } };
    f.handlers.get('parse')(event);
    f.context.Project = { uuid: 'different-project' };
    f.flush();
    expect(group.objcubed_equipment_part).toBe('');
    f.handlers.get('parse')(event);
    f.api.uninstallProjectPersistence();
    f.flush();
    expect(group.objcubed_equipment_part).toBe('');
    expect(f.handlers.size).toBe(0);
  });
});

describe('version-2 animal equipment packages isolated group bindings', () => {
  it('keeps two head groups with different pivots in separate layers without scrambling the item', async () => {
    const a = { part: 'head', pivot: [1, 2, 3], key: 'head-a' };
    const b = { part: 'head', pivot: [-2, 0, 4], key: 'head-b' };
    const result = exportResult([...Array(4).fill(a), ...Array(4).fill(b)]);
    const original = Buffer.from(result.rawBuf);
    const { api, memfs } = setup();
    await api.saveSingleOutput(result, {}, exportConfig('horse_body'));
    const layers = equipmentPngs(memfs, 'horse_body');
    expect(layers).toHaveLength(2);
    expect(layers.map(({ png }) => mappedFaces(png)).sort((x, y) => x[0] - y[0]))
      .toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
    for (const { png } of layers) {
      expect([...png.data.subarray(0, 4)]).toEqual([12, 34, 56, 252]);
      expect(png.data[8 * 4 + 3]).toBe(2);
      expect([...png.data.subarray(15 * 4, 16 * 4)]).toEqual([79, 67, 50, 1]);
      expect([...png.data.subarray(14 * 4 + 2, 15 * 4)]).toEqual([6, 0]);
      const descriptorRow = png.data[14 * 4] * 256 + png.data[14 * 4 + 1];
      expect(descriptorRow).toBeGreaterThanOrEqual(result.ty);
      expect(png.data.length - descriptorRow * png.width * 4).toBeGreaterThanOrEqual(99 * 4);
      expect(png.width).toBe(result.tw);
      expect([...png.data.subarray(4, 8 * 4)]).toEqual([...original.subarray(4, 8 * 4)]);
      expect([...png.data.subarray(result.tw * 4, original.length)])
        .toEqual([...original.subarray(result.tw * 4)]);
      for (let face = 0; face < 6; face++) {
        const offset = (8 + face) * 4;
        const index = png.data[offset] * 256 + png.data[offset + 1];
        expect(png.data[offset + 2]).toBe(index === 65535 ? 0 : result.faceEmission[index]);
      }
    }
    expect(result.rawBuf).toEqual(original);
    expect(memfs.writes.get('/rp/assets/objcubed/textures/item/animal_model.png')).toEqual(result.pngBuffer);
  });

  it('does not merge body and head faces when one group alone needs multiple layers', async () => {
    const body = { part: 'body', pivot: [0, 0, 0], key: 'body' };
    const head = { part: 'head', pivot: [0, 1, 0], key: 'head' };
    const result = exportResult([...Array(7).fill(body), ...Array(2).fill(head)]);
    const { api, memfs } = setup();
    await api.saveSingleOutput(result, {}, exportConfig('horse_body'));
    const mappings = equipmentPngs(memfs, 'horse_body').map(({ png }) => mappedFaces(png));
    expect(mappings).toHaveLength(3);
    expect(mappings.map(v => v.length).sort()).toEqual([1, 2, 6]);
    expect(mappings.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(mappings.some(v => v.includes(7) && v.includes(8))).toBe(true);
    expect(mappings.every(v => !v.some(i => i < 7) || !v.some(i => i >= 7))).toBe(true);
  });

  it('new wolf equipment uses version 2 and the wolf layer without humanoid fallback', async () => {
    const result = exportResult([{ part: 'body', pivot: [0, 0, 0], key: 'default' }]);
    const { api, memfs } = setup();
    const cfg = exportConfig('wolf_body');
    await api.saveSingleOutput(result, {}, cfg);
    const layers = equipmentPngs(memfs, 'wolf_body');
    expect(layers).toHaveLength(1);
    expect(layers[0].png.data[8 * 4 + 3]).toBe(2);
    expect([...memfs.writes.keys()].some(name => name.includes('/equipment/humanoid/'))).toBe(false);
    const definition = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/animal_model_wolf_body.json'));
    expect(Object.keys(definition.layers)).toEqual(['wolf_body']);
    expect(cfg.selectedPieces).toEqual(['helmet']);
    expect(cfg.baseItem).toBe('stick');
    expect(memfs.writes.get('/rp/assets/objcubed/textures/item/animal_model.png')).toEqual(result.pngBuffer);
  });

  it('rejects an unsupported explicit part before publishing equipment', async () => {
    const result = exportResult([{ part: 'not_a_native_part', pivot: [0, 0, 0], key: 'bad-group' }]);
    const { api, memfs } = setup();
    await expect(api.saveSingleOutput(result, {}, exportConfig('horse_body')))
      .rejects.toThrow(/part|binding|not_a_native_part/i);
    expect(equipmentPngs(memfs, 'horse_body')).toEqual([]);
  });
});

describe('animal exports preserve the assembled ordinary item geometry', () => {
  it.each(TARGETS)('%s bypasses humanoid recentering even with saved humanoid pieces', async target => {
    const { api, context } = setup();
    class Image {
      set src(_) { queueMicrotask(() => this.onload()); }
      get naturalWidth() { return 16; }
      get naturalHeight() { return 16; }
    }
    context.Image = Image;
    context.Texture = { all: [{ uuid: 'u', source: 'data:test' }] };
    context.document = { createElement() { return { getContext() { return {
      drawImage() {}, getImageData() { return { data: new Uint8Array(16 * 16 * 4).fill(255), width: 16, height: 16 }; },
    }; } }; } };
    const obj = ['o ocp3e7i0', 'v 3 5 7', 'v 4 5 7', 'v 4 6 7', 'v 3 6 7',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'usemtl m_u', 'f 1/1 2/2 3/3 4/4'].join('\n');
    const cfg = { texIndex: 0, useAtlas: false, texAnimEnabled: false, nopow: false,
      scale: 1.25, offset: [1, -2, 3], colorbehavior: ['direct', 'direct', 'direct'],
      duration: 0, autoplay: false, easing: 0, interpolation: 0, noshadow: false,
      autorotate: 3, visibility: 7, displaySlots: {}, flipuv: false };
    const item = await api.buildOutput(cfg, [obj], '');
    const equipment = await api.buildOutput({ ...cfg, ...exportConfig(target) }, [obj], '');
    expect(equipment.rawBuf).toEqual(item.rawBuf);
    expect(equipment.faceEmission).toEqual([7]);
    if (target === 'horse_body' || target === 'horse_saddle') {
      // Null is the documented v1 compatibility signal when no new tag exists.
      expect(equipment.faceToEquipmentBinding).toBeNull();
    } else {
      expect(equipment.faceToEquipmentBinding).toHaveLength(1);
      expect(equipment.faceToEquipmentBinding[0]).toMatchObject({ pivot: [0, 0, 0], key: 'default' });
      expect(typeof equipment.faceToEquipmentBinding[0].part).toBe('string');
    }
  });
});

describe('explicit group binding follows ancestry and stable OBJ token identity', () => {
  it('uses the nearest tagged group and treats its zero pivot as an explicit attachment point', () => {
    const body = { uuid: 'parent', name: 'body', objcubed_equipment_part: 'body', origin: [16, 32, 48], parent: 'root' };
    const head = { uuid: 'child', name: 'same', objcubed_equipment_part: 'head', origin: [0, 0, 0], parent: body };
    const cube = { name: 'cube', parent: head };
    const { api } = setup([body, head]);
    expect(api.equipmentBindingOfElement(cube, exportConfig('horse_body')))
      .toMatchObject({ part: 'head', pivot: [0, 0, 0], key: 'child', explicit: true });
    head.objcubed_equipment_part = '';
    expect(api.equipmentBindingOfElement(cube, exportConfig('horse_body')))
      .toMatchObject({ part: 'body', pivot: [1, 2, 3], key: 'parent', explicit: true });
  });

  it('never infers new animal tags from old humanoid names or numeric IDs', () => {
    const parent = { uuid: 'head', name: 'head', objcubed_body_part: 1, origin: [32, 16, 48], parent: 'root' };
    const { api } = setup([parent]);
    expect(api.equipmentBindingOfElement({ name: 'right_leg', objcubed_body_part: 4, parent }, exportConfig('horse_body')))
      .toMatchObject({ part: 'body', pivot: [0, 0, 0], key: 'default', explicit: false });
  });

  it('maps reversed OBJ token ordinals to duplicate Cube/Mesh names without merging their groups', () => {
    class Cube { constructor(parent) { Object.assign(this, { name: 'cube', parent, type: 'cube' }); } }
    class Mesh { constructor(parent) { Object.assign(this, { name: 'cube', parent, type: 'mesh' }); } }
    const first = { uuid: 'a', name: 'same', origin: [0, 0, 0], objcubed_equipment_part: 'head', parent: 'root' };
    const second = { uuid: 'b', name: 'same', origin: [16, 32, 48], objcubed_equipment_part: 'head', parent: 'root' };
    const { api, context } = setup([first, second]);
    context.Cube = Cube; context.Mesh = Mesh;
    context.Outliner.elements = [first, new Cube(first), { type: 'locator', name: 'cube' }, new Mesh(second)];
    const bindings = api.buildFaceEquipmentBindings(['ocp0e15i1', 'ocp0e0i0', 'ocp0e15i1'], exportConfig('horse_body'));
    expect(bindings.map(b => ({ part: b.part, pivot: b.pivot, key: b.key }))).toEqual([
      { part: 'head', pivot: [1, 2, 3], key: 'b' },
      { part: 'head', pivot: [0, 0, 0], key: 'a' },
      { part: 'head', pivot: [1, 2, 3], key: 'b' },
    ]);
  });

  it.each([[NaN, 0, 0], [0, Infinity, 0], [1, 2], null])('rejects a malformed tagged pivot %j', origin => {
    const group = { uuid: 'broken', objcubed_equipment_part: 'head', origin, parent: 'root' };
    const { api } = setup([group]);
    expect(() => api.equipmentBindingOfElement({ parent: group }, exportConfig('horse_body')))
      .toThrow(/finite|origin|pivot/i);
  });

  it('rejects a role supported by another equipment family instead of silently attaching to the default', () => {
    const group = { uuid: 'wrong-family', objcubed_equipment_part: 'head', origin: [0, 0, 0], parent: 'root' };
    const { api } = setup([group]);
    expect(() => api.equipmentBindingOfElement({ parent: group }, exportConfig('wings')))
      .toThrow(/head|supported|wings/i);
  });
});

describe('animal datapacks use the actual wearer and slot', () => {
  it.each(TARGETS)('%s writes animation controls for its native slot', async target => {
    const { api, memfs } = setup();
    const defaultPart = target === 'wings' ? 'wings' : target === 'happy_ghast_body' ? 'harness'
      : target.startsWith('nautilus_') ? 'shell' : 'body';
    const result = exportResult([{ part: defaultPart, pivot: [0, 0, 0], key: 'default' }]);
    result.nframes = 4;
    await api.saveSingleOutput(result, {}, { ...exportConfig(target),
      generateDatapack: true, datapackOutputDir: '/dp', datapackNamespace: 'animal_test',
      datapackAnimId: 'walk', datapackTargetType: 'equipment', datapackEquipSlot: 'head' });
    const prefix = '/dp/objcubed/data/animal_test/function/walk';
    const slot = target === 'wings' ? 'chest' : target.endsWith('_saddle') ? 'saddle' : 'body';
    for (const mode of ['auto', 'manual']) {
      const fn = memfs.writes.get(`${prefix}/zzz/_apply_${mode}.mcfunction`);
      expect(fn).toContain(`equipment.${slot}.components."minecraft:dyed_color"`);
      expect(fn).not.toContain('minecraft:potion_contents');
      if (target === 'wings') {
        expect(fn).toContain('armor.chest from entity @s armor.chest');
        expect(fn).toContain('item replace entity @s armor.chest');
        expect(fn).not.toContain('data modify entity @s ');
        expect(fn).toContain('run kill @e[');
      }
    }
    const summon = memfs.writes.get(`${prefix}/summon.mcfunction`);
    if (target === 'wings') expect(summon).toBeUndefined();
    else {
      const entity = target.replace(/_(body|saddle)$/, '');
      expect(summon).toContain(`summon ${entity} `);
      expect(summon).toContain(`equipment:{${slot}:`);
      expect(summon).toContain(`minecraft:animal_model_${target}`);
      expect(summon).not.toContain('summon armor_stand ');
    }
    const exportedGive = memfs.writes.get(`/rp/assets/minecraft/equipment/animal_model_${target}_give.txt`);
    expect(exportedGive).toContain(`minecraft:animal_model_${target}`);
    expect(exportedGive).toContain('minecraft:custom_model_data={strings:["animal_model"]}');
  });
});

describe('real OBJ compile and animated geometry retain animal bindings', () => {
  it('keeps reversed duplicate Cube/Mesh names, light levels and pivots through compile → buildOutput', async () => {
    class Cube { constructor(parent) { Object.assign(this, { name: 'cube', uuid: 'cube', type: 'cube', parent, objcubed_light_emission: 15 }); } }
    class Mesh { constructor(parent) { Object.assign(this, { name: 'cube', uuid: 'mesh', type: 'mesh', parent, objcubed_light_emission: 0 }); } }
    const body = { uuid: 'body-group', name: 'same', type: 'group', origin: [16, 32, 0], objcubed_equipment_part: 'body', parent: 'root', children: [] };
    const head = { uuid: 'head-group', name: 'same', type: 'group', origin: [0, 0, 0], objcubed_equipment_part: 'head', parent: body, children: [] };
    const cube = new Cube(head), mesh = new Mesh(body);
    body.children = [head, mesh]; head.children = [cube];
    const f = persistenceFixture([body, head]);
    Object.assign(f.context, { Buffer, Cube, Mesh, Outliner: { root: [body], elements: [body, head, cube, mesh] } });
    f.context.Codecs.obj = { compile() {
      return { obj: [mesh, cube].map((element, i) => {
        const b = i * 4;
        return [`o ${element.name}`, `v ${2 + i} 3 4`, `v ${3 + i} 3 4`, `v ${3 + i} 4 4`, `v ${2 + i} 4 4`,
          'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'usemtl m_u',
          `f ${b + 1}/${b + 1} ${b + 2}/${b + 2} ${b + 3}/${b + 3} ${b + 4}/${b + 4}`].join('\n');
      }).join('\n'), mtl: '' };
    } };
    class Image {
      set src(_) { queueMicrotask(() => this.onload()); }
      get naturalWidth() { return 16; }
      get naturalHeight() { return 16; }
    }
    f.context.Image = Image;
    f.context.Texture = { all: [{ uuid: 'u', source: 'data:test' }] };
    f.context.document = { createElement() { return { getContext() { return {
      drawImage() {}, getImageData() { return { data: new Uint8Array(16 * 16 * 4).fill(255), width: 16, height: 16 }; },
    }; } }; } };
    const cfg = { ...exportConfig('horse_body'), animationEnabled: false, texIndex: 0,
      texAnimEnabled: false, useAtlas: false, scale: 1.25, offset: [1, -2, 3],
      colorbehavior: ['direct', 'direct', 'direct'], duration: 2, autoplay: false,
      easing: 1, interpolation: 1, autorotate: 3, visibility: 7, displaySlots: {}, flipuv: false };
    const compiled = await f.api.getObjContents(cfg);
    expect([cube.name, mesh.name]).toEqual(['cube', 'cube']);
    const next = compiled.objs[0].replace(/^v ([^ ]+) /gm, (_, x) => `v ${Number(x) + 0.25} `);
    const frames = [compiled.objs[0], next];
    const result = await f.api.buildOutput(cfg, frames, compiled.mtl);
    const item = await f.api.buildOutput({ ...cfg, exportAsEquipment: false }, frames, compiled.mtl);
    expect(result.nframes).toBe(2);
    expect(result.rawBuf).toEqual(item.rawBuf);
    expect(result.faceEmission).toEqual([0, 15]);
    expect(result.faceToEquipmentBinding.map(b => ({ part: b.part, key: b.key, pivot: b.pivot }))).toEqual([
      { part: 'body', key: 'body-group', pivot: [1, 2, 0] },
      { part: 'head', key: 'head-group', pivot: [0, 0, 0] },
    ]);
    expect([body.origin, head.origin]).toEqual([[16, 32, 0], [0, 0, 0]]);
  });
});
