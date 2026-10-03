// Issue #7: one-shot resource-pack export into the objcubed namespace.
// saveSingleOutput must write the PNG, per-slot models and the vanilla item
// override directly via fs (NO Blockbench.export / save dialogs), under a single
// resource pack root.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { makeMemFs } = require('../helpers/mem-fs.cjs');
const nodePath = require('node:path');

// Force posix-style joins so the asserted keys match regardless of host OS.
const posixPath = { ...nodePath, ...nodePath.posix };

function setup() {
  const memfs = makeMemFs();
  let exportCalled = false;
  const { api } = loadObjcubedWithContext({
    globals: {
      Blockbench: {
        export() { exportCalled = true; throw new Error('dialog opened'); },
        pickDirectory() { return '/rp'; },
      },
      Project: { name: 'cat', export_path: '' },
      BarItems: {},
    },
    requireImpl: id =>
      id === 'fs' ? memfs : id === 'path' ? posixPath : require(id),
  });
  return { api, memfs, wasExportCalled: () => exportCalled };
}

const RESULT = {
  pngBuffer: Buffer.from([1, 2, 3]),
  // encoder-shaped carrier element: face uv = (px+0.1)*16/tw with px=0, tw=16
  elements: [{ from: [0, 0, 0], to: [16, 16, 16],
    faces: { north: { uv: [0.1, 2.1, 0.9, 2.9], texture: '#0', tintindex: 0 } } }],
  nframes: 1,
};

describe('resource pack export (#7)', () => {
  const givePath = '/rp/assets/minecraft/items/iron_ingot_give.txt';
  const giveCommand = name => `give @s minecraft:iron_ingot[minecraft:custom_model_data={strings:["${name}"]}]`;
  const exportModel = (api, cmdName = 'cat') => api.saveSingleOutput(RESULT, {}, {
    resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false, cmdName,
  });

  it('keeps manual and earlier model commands when exporting another model on the same item', async () => {
    const { api, memfs } = setup();
    const manual = '# My custom commands\ngive @s minecraft:diamond 2\n';
    memfs.writes.set(givePath, manual);
    await exportModel(api, 'cat');
    await exportModel(api, 'dog');
    await exportModel(api, 'cat');
    const text = memfs.writes.get(givePath);
    expect(text.startsWith(manual)).toBe(true);
    const lines = text.split(/\r?\n/);
    expect(lines.filter(line => line === giveCommand('cat'))).toHaveLength(1);
    expect(lines.filter(line => line === giveCommand('dog'))).toHaveLength(1);
    const item = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    expect(item.model.cases.map(c => c.when).sort()).toEqual(['cat', 'dog']);
  });

  it.each([
    ['LF', '# Notes\ngive @s minecraft:stone 4\n'],
    ['CRLF', '# Notes\r\ngive @s minecraft:stone 4\r\n'],
    ['no final newline', '# Notes\r\ngive @s minecraft:stone 4'],
  ])('preserves existing bytes and separates a new command with %s content', async (_label, existing) => {
    const { api, memfs } = setup();
    memfs.writes.set(givePath, existing);
    await exportModel(api);
    const text = memfs.writes.get(givePath);
    expect(text.startsWith(existing)).toBe(true);
    expect(text.split(/\r?\n/).filter(line => line === giveCommand('cat'))).toHaveLength(1);
    expect(text.split(/\r?\n/)).toContain('give @s minecraft:stone 4');
  });

  it.each(['\n', '\r\n', ''])('does not rewrite an already present command (ending %j)', async eol => {
    const { api, memfs } = setup();
    const existing = '# Manual note\r\n' + giveCommand('cat') + eol;
    memfs.writes.set(givePath, existing);
    await exportModel(api);
    expect(memfs.writes.get(givePath)).toBe(existing);
  });

  it('rejects an unreadable give file without overwriting its previous content', async () => {
    const { api, memfs } = setup();
    const existing = '# Important commands\ngive @s minecraft:stone\n';
    memfs.writes.set(givePath, existing);
    const read = memfs.readFileSync.bind(memfs);
    memfs.readFileSync = (p, ...args) => {
      if (p === givePath) throw Object.assign(new Error('give file read denied'), { code: 'EACCES' });
      return read(p, ...args);
    };
    await expect(exportModel(api)).rejects.toThrow('give file read denied');
    expect(memfs.writes.get(givePath)).toBe(existing);
  });

  it('keeps the previous give file if a write fails after writing partial bytes', async () => {
    const { api, memfs } = setup();
    const existing = '# Important commands\ngive @s minecraft:stone\n';
    memfs.writes.set(givePath, existing);
    const write = memfs.writeFileSync.bind(memfs);
    memfs.writeFileSync = (p, content, ...args) => {
      if (p === givePath || p.startsWith(givePath + '.')) {
        write(p, 'partial');
        throw Object.assign(new Error('give file disk full'), { code: 'ENOSPC' });
      }
      return write(p, content, ...args);
    };
    await expect(exportModel(api)).rejects.toThrow('give file disk full');
    expect(memfs.writes.get(givePath)).toBe(existing);
  });

  it('keeps the previous give file when the final replacement is denied', async () => {
    const { api, memfs } = setup();
    const existing = '# Important commands\ngive @s minecraft:stone\n';
    memfs.writes.set(givePath, existing);
    const rename = memfs.renameSync.bind(memfs);
    memfs.renameSync = (from, to) => {
      if (to === givePath) throw Object.assign(new Error('give file replace denied'), { code: 'EACCES' });
      return rename(from, to);
    };
    await expect(exportModel(api)).rejects.toThrow('give file replace denied');
    expect(memfs.writes.get(givePath)).toBe(existing);
  });

  it('uses the vanilla 26.3 items atlas without registering item textures in blocks', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });

    // 26.3 assets/minecraft/atlases/items.json already discovers
    // textures/item/*.png across namespaces. An item directory source in the
    // blocks atlas duplicates both the vanilla items and this exported sprite.
    const model = JSON.parse(memfs.writes.get('/rp/assets/objcubed/models/item/cat_default.json'));
    expect(model.textures['0']).toBe('objcubed:item/cat');
    expect(memfs.writes.has('/rp/assets/objcubed/textures/item/cat.png')).toBe(true);
    expect([...memfs.writes.keys()].filter(p => p.includes('/atlases/'))).toEqual([]);
  });

  it.each([
    '{ "sources": [{"type":"minecraft:single","resource":"custom:special"}], "owner":"user" }\n',
    '{ "sources": [{"type":"minecraft:directory","source":"item","prefix":"item/"}] }\n',
    'unfinished user atlas {\n',
  ])('leaves existing atlas content byte-for-byte unchanged: %s', async existing => {
    const { api, memfs } = setup();
    const blocksPath = '/rp/assets/minecraft/atlases/blocks.json';
    const itemsPath = '/rp/assets/minecraft/atlases/items.json';
    memfs.writes.set(blocksPath, existing);
    memfs.writes.set(itemsPath, existing);
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });
    expect(memfs.writes.get(blocksPath)).toBe(existing);
    expect(memfs.writes.get(itemsPath)).toBe(existing);
  });

  it('writes the full objcubed layout with no Blockbench.export', async () => {
    const { api, memfs, wasExportCalled } = setup();

    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });

    // (1) No save dialog ever opened.
    expect(wasExportCalled()).toBe(false);

    const keys = [...memfs.writes.keys()];

    // (2) Expected write keys.
    expect(keys).toContain('/rp/assets/objcubed/textures/item/cat.png');
    expect(keys).toContain('/rp/assets/objcubed/models/item/cat_thirdperson_righthand.json');
    expect(keys).toContain('/rp/assets/minecraft/items/iron_ingot.json');

    // (3) Model JSON texture refs are namespaced + particle present.
    const model = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_thirdperson_righthand.json')
    );
    expect(model.textures['0']).toBe('objcubed:item/cat');
    expect(model.textures.particle).toBeTruthy();

    // (4) Item override: vanilla fallback + a custom_model_data case for 'cat'.
    const item = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    expect(item.model.type).toBe('minecraft:select');
    expect(item.model.property).toBe('minecraft:custom_model_data');
    // Reads strings[0] of the custom_model_data component (1.21.4+ shape).
    expect(item.model.index).toBe(0);
    expect(item.model.fallback.model).toBe('minecraft:item/iron_ingot');
    const catCase = item.model.cases.find(c => c.when === 'cat');
    expect(catCase).toBeTruthy();

    // (4b) give helper: exact command with the custom_model_data string (#7).
    expect(keys).toContain('/rp/assets/minecraft/items/iron_ingot_give.txt');
    const give = memfs.writes.get('/rp/assets/minecraft/items/iron_ingot_give.txt');
    expect(give).toContain('give @s minecraft:iron_ingot[minecraft:custom_model_data={strings:["cat"]}]');

    // (5) Every model ref string in the items json is namespaced (no bare custom/).
    const refs = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.model === 'string') refs.push(node.model);
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    })(item);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.startsWith('custom/')).toBe(false);
      const ok = r.startsWith('objcubed:item/') || r === 'minecraft:item/iron_ingot';
      expect(ok, `ref ${r}`).toBe(true);
    }
  });

  it('lifts model.json-display slots -8 Y to compensate the centre-carrier over-lift (ANCHOR_LIFT_Y=-8)', async () => {
    const { api, memfs } = setup();

    // User touched NO display settings: displayTransforms = {}.
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });

    // The carrier anchor c2 is at the cube CENTRE ([8,8,8]) and the decoded model
    // is block-centre relative, so every model.json lift is 0 (in-game verified:
    // lift-0 hand/world slots match the same vanilla model exactly). ground/
    // on_shelf ride half a block higher in vanilla's dropped-item pipeline —
    // compensated by +8 carrier-element offsets (SLOT_OFFSETS). gui is
    // header-encoded.
    const model = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_thirdperson_righthand.json')
    );
    // All lifts are 0: the decoded model is already block-centre relative, so
    // no model.json compensation is needed (the old -6/-8 constants pushed the
    // model below the same vanilla model). The explicit identity entries must
    // still be written (they stop MC leaking block-model display defaults into
    // un-set slots).
    const lift = (y) => ({ rotation: [0, 0, 0], translation: [0, y, 0], scale: [1, 1, 1] });
    for (const s of ['head', 'fixed', 'thirdperson_righthand', 'thirdperson_lefthand',
                     'firstperson_righthand', 'firstperson_lefthand']) {
      expect(model.display[s], s).toEqual(lift(0));
    }
    // ground/on_shelf display stays identity (MC clamps ground translation Y);
    // their full-block dropped-item offset = +8 carrier elements + the shader
    // slot-marker half (0.2 UV margins, asserted below).
    for (const s of ['ground', 'on_shelf']) {
      if (model.display[s]) expect(model.display[s], s).toEqual(lift(0));
    }

    // Slot marker v2: each slot json's U midpoint = px + 0.5 + id*0.035.
    // With no custom display, both hands occupy ids 1/2, ground id 3
    // and shelf id 4; the plain/neutral json keeps 0.5 (id 0). The shader
    // reads the quad's U midpoint (shrink-invariant) to recover the id.
    const groundModel = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_ground.json'));
    const mainUv = model.elements[0].faces.north.uv;
    const groundUv = groundModel.elements[0].faces.north.uv;
    const umidOf = (uv, tw) => ((uv[0] + uv[2]) / 2 * tw / 16) % 1; // uv = (px+m)*16/tw
    expect(umidOf(mainUv, 16)).toBeCloseTo(0.5, 5);
    expect(umidOf(groundUv, 16)).toBeCloseTo(0.605, 5);
    // The neutral default fallback json exists and carries marker id 0.
    const defModel = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_default.json'));
    expect(umidOf(defModel.elements[0].faces.north.uv, 16)).toBeCloseTo(0.5, 5);
    // and the ground carrier still sits +8 above the main one (element offset)
    expect(groundModel.elements[0].from[1]).toBe(model.elements[0].from[1] + 8);
  });

  it('exports both identity hand contexts with explicit markers and selector cases', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });
    const item = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    const contexts = item.model.cases.find(c => c.when === 'cat').model;
    for (const [slot, id] of [['firstperson_righthand', 1], ['firstperson_lefthand', 2]]) {
      const ref = `objcubed:item/cat_${slot}`;
      expect(contexts.cases.find(c => c.when === slot)?.model.model).toBe(ref);
      const model = JSON.parse(memfs.writes.get(`/rp/assets/objcubed/models/item/cat_${slot}.json`));
      const uv = model.elements[0].faces.north.uv;
      expect((uv[0] + uv[2]) / 2).toBeCloseTo(0.5 + id * 0.035, 6);
    }
  });

  it('a slot with a distinct Z scale gets a DYNAMIC marker id (U midpoint 0.5 + id*0.035)', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {
      thirdperson_righthand: { scale: [2, 2, 0.5] },   // Sz != min(Sx,Sy) -> dynamic id 1
    }, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });
    const third = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_thirdperson_righthand.json'));
    const umidOf = (uv, tw) => ((uv[0] + uv[2]) / 2 * tw / 16) % 1;
    expect(umidOf(third.elements[0].faces.north.uv, 16)).toBeCloseTo(0.535, 5);
    // ...and the neutral default stays id 0.
    const def = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_default.json'));
    expect(umidOf(def.elements[0].faces.north.uv, 16)).toBeCloseTo(0.5, 5);
    // item selector: thirdperson now has its OWN case; fallback -> _default
    const item = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    const catCase = item.model.cases.find(c => c.when === 'cat').model;
    expect(catCase.cases.some(c => c.when === 'thirdperson_righthand')).toBe(true);
    expect(catCase.fallback.model).toBe('objcubed:item/cat_default');
  });

  it('armor export does NOT shift item elements (the -0.5 is baked into the PNG for all exports)', async () => {
    // The -0.5 vertical-origin re-anchor rides the PNG positions for armor too
    // (the armor SHADER path re-adds it); an element-shift compensation only
    // matched at identity display, so it must NOT come back.
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, equipmentSlot: 'chest',
    });
    const m = JSON.parse(
      memfs.writes.get('/rp/assets/objcubed/models/item/cat_thirdperson_righthand.json'));
    expect(m.elements[0].from[1]).toBe(RESULT.elements[0].from[1]);
    expect(m.elements[0].to[1]).toBe(RESULT.elements[0].to[1]);
  });

  it('cfg.cmdName drives the model/item case key and give command (#7)', async () => {
    const { api, memfs } = setup();

    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      cmdName: 'My Key',
    });

    const keys = [...memfs.writes.keys()];
    const slug = 'my_key'; // sanitized (lowercased, non [a-z0-9_] -> _)

    // PNG + per-slot model + texture ref all keyed by the sanitized cmdName.
    expect(keys).toContain(`/rp/assets/objcubed/textures/item/${slug}.png`);
    expect(keys).toContain(`/rp/assets/objcubed/models/item/${slug}_thirdperson_righthand.json`);
    const model = JSON.parse(
      memfs.writes.get(`/rp/assets/objcubed/models/item/${slug}_thirdperson_righthand.json`)
    );
    expect(model.textures['0']).toBe(`objcubed:item/${slug}`);

    // Item override case key matches the sanitized cmdName.
    const item = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    expect(item.model.index).toBe(0);
    expect(item.model.cases.find(c => c.when === slug)).toBeTruthy();

    // give command carries the sanitized cmdName as strings[0].
    const give = memfs.writes.get('/rp/assets/minecraft/items/iron_ingot_give.txt');
    expect(give).toContain(`give @s minecraft:iron_ingot[minecraft:custom_model_data={strings:["${slug}"]}]`);
  });

  it('buildItemSelector namespaces refs and points fallback at the base item', () => {
    const { api } = setup();
    const sel = api.buildItemSelector('foo', undefined, 'iron_ingot');
    expect(sel.model.property).toBe('minecraft:custom_model_data');
    expect(sel.model.index).toBe(0);
    expect(sel.model.fallback.model).toBe('minecraft:item/iron_ingot');

    const refs = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.model === 'string') refs.push(node.model);
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') walk(v);
      }
    })(sel);
    expect(refs.some(r => r.startsWith('objcubed:item/foo'))).toBe(true);
    for (const r of refs) expect(r.startsWith('custom/')).toBe(false);
  });
});


describe('file export and selected display contexts', () => {
  it('writes just PNG and default JSON into the chosen folder, with a custom texture reference', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {}, {outputMode:'files', filesOutputDir:'/loose', resourcePackDir:'/untouched', selectedContexts:[], textureResource:'custom:models/cat'});
    expect([...memfs.writes.keys()].sort()).toEqual(['/loose/cat.png','/loose/cat_default.json']);
    expect([...memfs.dirs]).toEqual(['/loose']);
    const model = JSON.parse(memfs.writes.get('/loose/cat_default.json'));
    expect(model.textures).toEqual({'0':'custom:models/cat', particle:'custom:models/cat'});
    expect(model.elements).toEqual(RESULT.elements);
  });

  it('writes only selected variants and updates the selector without losing other models', async () => {
    const { api, memfs } = setup();
    const cfg = {resourcePackDir:'/rp', baseItem:'iron_ingot', selectedContexts:[]};
    await api.saveSingleOutput(RESULT, {}, {...cfg, cmdName:'dog'});
    await api.saveSingleOutput(RESULT, {}, {...cfg, selectedContexts:['fixed'], cmdName:'cat'});
    const files = [...memfs.writes.keys()].filter(p => p.includes('/models/'));
    expect(files.sort()).toEqual(['/rp/assets/objcubed/models/item/cat_default.json','/rp/assets/objcubed/models/item/cat_fixed.json','/rp/assets/objcubed/models/item/dog_default.json']);
    const selector = JSON.parse(memfs.writes.get('/rp/assets/minecraft/items/iron_ingot.json'));
    const cat = selector.model.cases.find(c => c.when === 'cat').model;
    expect(cat.cases.map(c => c.when)).toEqual(['fixed']);
    expect(cat.fallback.model).toBe('objcubed:item/cat_default');
    const dog = selector.model.cases.find(c => c.when === 'dog').model;
    expect(dog).toMatchObject({type:'minecraft:model', model:'objcubed:item/dog_default'});
  });

  it('keeps hand slot calibration when exporting loose selected variants', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(RESULT, {}, {outputMode:'files', filesOutputDir:'/loose', selectedContexts:['firstperson_righthand']});
    expect([...memfs.writes.keys()].sort()).toEqual(['/loose/cat.png','/loose/cat_default.json','/loose/cat_firstperson_righthand.json']);
    const hand = JSON.parse(memfs.writes.get('/loose/cat_firstperson_righthand.json'));
    expect(hand.elements[0].faces.north.uv).not.toEqual(RESULT.elements[0].faces.north.uv);
    expect(hand.textures['0']).toBe('objcubed:item/cat');
  });

  it.each([{generateDatapack:true},{exportAsEquipment:true},{textureResource:'bad:../cat'},{textureResource:'bad:cat.png'}])('rejects incompatible/invalid file output before writing %j', async extra => {
    const { api, memfs } = setup();
    await expect(api.saveSingleOutput(RESULT, {}, {outputMode:'files', filesOutputDir:'/loose', ...extra})).rejects.toThrow();
    expect(memfs.writes.size).toBe(0);
    expect(memfs.dirs.size).toBe(0);
  });
});
