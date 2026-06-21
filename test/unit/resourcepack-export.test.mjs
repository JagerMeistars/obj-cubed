// Issue #7: one-shot resource-pack export into the objc_cubed namespace.
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
  elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
  nframes: 1,
};

describe('resource pack export (#7)', () => {
  it('writes the full objc_cubed layout with no Blockbench.export', async () => {
    const { api, memfs, wasExportCalled } = setup();

    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });

    // (1) No save dialog ever opened.
    expect(wasExportCalled()).toBe(false);

    const keys = [...memfs.writes.keys()];

    // (2) Expected write keys.
    expect(keys).toContain('/rp/assets/objc_cubed/textures/item/cat.png');
    expect(keys).toContain('/rp/assets/objc_cubed/models/item/cat_thirdperson_righthand.json');
    expect(keys).toContain('/rp/assets/minecraft/items/iron_ingot.json');

    // (3) Model JSON texture refs are namespaced + particle present.
    const model = JSON.parse(
      memfs.writes.get('/rp/assets/objc_cubed/models/item/cat_thirdperson_righthand.json')
    );
    expect(model.textures['0']).toBe('objc_cubed:item/cat');
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
      const ok = r.startsWith('objc_cubed:item/') || r === 'minecraft:item/iron_ingot';
      expect(ok, `ref ${r}`).toBe(true);
    }
  });

  it('writes a +8 Y anchor baseline for model.json-driven slots (not ~0.5 block low; block defaults cannot leak)', async () => {
    const { api, memfs } = setup();

    // User touched NO display settings: displayTransforms = {}.
    await api.saveSingleOutput(RESULT, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
    });

    // The carrier anchor (corner 2) puts every model.json-driven slot ~0.5 block
    // (8 BB) low. GUI fixes this in-shader; these slots get an explicit +8 Y
    // baseline written here. The explicit entry also stops Minecraft leaking
    // block-model display defaults (scale ~0.4) into un-set slots.
    const model = JSON.parse(
      memfs.writes.get('/rp/assets/objc_cubed/models/item/cat_thirdperson_righthand.json')
    );
    const LIFTED = { rotation: [0, 0, 0], translation: [0, 8, 0], scale: [1, 1, 1] };
    for (const s of ['firstperson_righthand', 'firstperson_lefthand',
                     'thirdperson_righthand', 'head']) {
      expect(model.display[s], s).toEqual(LIFTED);
    }
    // fixed is NOT lifted (item-frame rotation would orbit it) — plain identity,
    // which still blocks block-model default leakage.
    expect(model.display.fixed).toEqual({ rotation: [0, 0, 0], translation: [0, 0, 0], scale: [1, 1, 1] });
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
    expect(keys).toContain(`/rp/assets/objc_cubed/textures/item/${slug}.png`);
    expect(keys).toContain(`/rp/assets/objc_cubed/models/item/${slug}_thirdperson_righthand.json`);
    const model = JSON.parse(
      memfs.writes.get(`/rp/assets/objc_cubed/models/item/${slug}_thirdperson_righthand.json`)
    );
    expect(model.textures['0']).toBe(`objc_cubed:item/${slug}`);

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
    expect(refs.some(r => r.startsWith('objc_cubed:item/foo'))).toBe(true);
    for (const r of refs) expect(r.startsWith('custom/')).toBe(false);
  });
});
