// Approach C equipment (armor) export. When cfg.exportAsEquipment is set,
// saveSingleOutput must write — under the SAME resource pack root as the #7
// item layout, but into the vanilla minecraft namespace — one equipment-layer
// texture per model face plus an equipment definition JSON. Each texture is a
// copy of the full encoded model with:
//   - byte[3] = 253  (per-limb armor marker; legacy chest-only was 254)
//   - header pixel t[8] (bytes 32,33) = face index k (16-bit, high:low)
// so the shader picks the model face from the texture, count-independently.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { makeMemFs } = require('../helpers/mem-fs.cjs');
const nodePath = require('node:path');
const { PNG } = require('pngjs');

// Force posix-style joins so the asserted keys match regardless of host OS.
const posixPath = { ...nodePath, ...nodePath.posix };

const TW = 8;
const TY = 2;

function makeResult(nfaces) {
  // Full encoded texture bytes: tw*ty*4, with the marker [12,34,56,255] at the
  // very first pixel (bytes 0..3). The equipment block copies this buffer per
  // face and patches byte[3] and bytes 32/33, so the buffer must be long enough
  // that those offsets exist (tw*ty*4 = 64 >= 34).
  const rawBuf = Buffer.alloc(TW * TY * 4);
  rawBuf[0] = 12;
  rawBuf[1] = 34;
  rawBuf[2] = 56;
  rawBuf[3] = 255;
  return {
    pngBuffer: Buffer.from([1, 2, 3]),
    rawBuf,
    elements: [],
    nfaces,
    nframes: 1,
    tw: TW,
    ty: TY,
  };
}

function setup() {
  const memfs = makeMemFs();
  const { api } = loadObjcubedWithContext({
    globals: {
      // encodePNG (called by the equipment block) needs Buffer in the sandbox.
      Buffer,
      Blockbench: {
        export() { throw new Error('dialog'); },
        pickDirectory() { return '/rp'; },
      },
      Project: { name: 'cat', export_path: '' },
      BarItems: {},
    },
    requireImpl: id =>
      id === 'fs' ? memfs : id === 'path' ? posixPath : require(id),
  });
  return { api, memfs };
}

const EQ_TEX_DIR = '/rp/assets/minecraft/textures/entity/equipment/humanoid';
const EQ_JSON = '/rp/assets/minecraft/equipment/cat_chest.json';

describe('equipment (armor) export — Approach C', () => {
  it('writes one layer texture per face + equipment def, with marker 253 and t[8]=k', async () => {
    const { api, memfs } = setup();

    await api.saveSingleOutput(makeResult(3), {}, {
      resourcePackDir: '/rp',
      baseItem: 'iron_ingot',
      generateDatapack: false,
      exportAsEquipment: true,
      equipmentSlot: 'chest',
    });

    const keys = [...memfs.writes.keys()];

    // (1) Exactly nfaces (3) equipment textures at the expected paths.
    for (let k = 0; k < 3; k++) {
      expect(keys).toContain(`${EQ_TEX_DIR}/cat_chest_${k}.png`);
    }
    const eqTexKeys = keys.filter(p => p.startsWith(EQ_TEX_DIR + '/'));
    expect(eqTexKeys.length).toBe(3);

    // (2) Each decoded PNG carries marker alpha 253 and face index k in t[8].
    for (let k = 0; k < 3; k++) {
      const png = memfs.writes.get(`${EQ_TEX_DIR}/cat_chest_${k}.png`);
      const dec = PNG.sync.read(Buffer.from(png));
      expect(dec.width).toBe(TW);
      expect(dec.height).toBe(TY);
      // pixel0 = data[0..3]: marker [12,34,56,253].
      expect(dec.data[0]).toBe(12);
      expect(dec.data[1]).toBe(34);
      expect(dec.data[2]).toBe(56);
      expect(dec.data[3]).toBe(253); // per-limb armor marker
      // pixel8 = data[32..35]: t[8].r:.g == k (16-bit high:low).
      const faceIdx = dec.data[32] * 256 + dec.data[33];
      expect(faceIdx).toBe(k);
      expect(dec.data[34]).toBe(0); // t[8].b = target body part; chest = 0
    }

    // (3) Equipment definition references each layer texture.
    expect(keys).toContain(EQ_JSON);
    const def = JSON.parse(memfs.writes.get(EQ_JSON));
    expect(Array.isArray(def.layers.humanoid)).toBe(true);
    expect(def.layers.humanoid.length).toBe(3);
    for (let k = 0; k < 3; k++) {
      expect(def.layers.humanoid[k].texture).toBe(`minecraft:cat_chest_${k}`);
    }

    // (4) A _give.txt helper is written for in-game testing.
    expect(keys).toContain('/rp/assets/minecraft/equipment/cat_chest_give.txt');
    const give = memfs.writes.get('/rp/assets/minecraft/equipment/cat_chest_give.txt');
    expect(give).toContain('leather_chestplate');
    expect(give).toContain('asset_id:"minecraft:cat_chest"');
  });

  it('per-limb: each body part picks its layer, give item, equippable slot, and stamps t[8].b', async () => {
    const PARTS = [
      { slot: 'chest',      layer: 'humanoid',          give: 'chestplate', eq: 'chest', id: 0 },
      { slot: 'head',       layer: 'humanoid',          give: 'helmet',     eq: 'head',  id: 1 },
      { slot: 'right_arm',  layer: 'humanoid',          give: 'chestplate', eq: 'chest', id: 2 },
      { slot: 'left_arm',   layer: 'humanoid',          give: 'chestplate', eq: 'chest', id: 3 },
      { slot: 'right_leg',  layer: 'humanoid_leggings', give: 'leggings',   eq: 'legs',  id: 4 },
      { slot: 'left_leg',   layer: 'humanoid_leggings', give: 'leggings',   eq: 'legs',  id: 5 },
      { slot: 'right_foot', layer: 'humanoid',          give: 'boots',      eq: 'feet',  id: 6 },
      { slot: 'left_foot',  layer: 'humanoid',          give: 'boots',      eq: 'feet',  id: 7 },
    ];
    for (const p of PARTS) {
      const { api, memfs } = setup();
      await api.saveSingleOutput(makeResult(1), {}, {
        resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
        exportAsEquipment: true, equipmentSlot: p.slot,
      });
      const texPath = `/rp/assets/minecraft/textures/entity/equipment/${p.layer}/cat_${p.slot}_0.png`;
      expect([...memfs.writes.keys()], p.slot).toContain(texPath);
      const dec = PNG.sync.read(Buffer.from(memfs.writes.get(texPath)));
      expect(dec.data[34], `${p.slot} byte34`).toBe(p.id); // t[8].b = target part
      const def = JSON.parse(memfs.writes.get(`/rp/assets/minecraft/equipment/cat_${p.slot}.json`));
      expect(Array.isArray(def.layers[p.layer]), `${p.slot} layer`).toBe(true);
      const give = memfs.writes.get(`/rp/assets/minecraft/equipment/cat_${p.slot}_give.txt`);
      expect(give, `${p.slot} give`).toContain(`leather_${p.give}`);
      expect(give, `${p.slot} eqslot`).toContain(`slot:"${p.eq}"`);
    }
  });

  it('legacy coarse slots still map correctly (legs->leggings, feet->boots)', async () => {
    for (const c of [
      { slot: 'legs', layer: 'humanoid_leggings', give: 'leggings', eq: 'legs', id: 5 },
      { slot: 'feet', layer: 'humanoid',          give: 'boots',    eq: 'feet', id: 7 },
    ]) {
      const { api, memfs } = setup();
      await api.saveSingleOutput(makeResult(1), {}, {
        resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
        exportAsEquipment: true, equipmentSlot: c.slot,
      });
      const texPath = `/rp/assets/minecraft/textures/entity/equipment/${c.layer}/cat_${c.slot}_0.png`;
      expect([...memfs.writes.keys()], c.slot).toContain(texPath);
      const dec = PNG.sync.read(Buffer.from(memfs.writes.get(texPath)));
      expect(dec.data[34], `${c.slot} byte34`).toBe(c.id);
      const give = memfs.writes.get(`/rp/assets/minecraft/equipment/cat_${c.slot}_give.txt`);
      expect(give).toContain(`leather_${c.give}`);
      expect(give).toContain(`slot:"${c.eq}"`);
    }
  });

  it('legs slot uses the humanoid_leggings layer type', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(makeResult(2), {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, equipmentSlot: 'legs',
    });
    const keys = [...memfs.writes.keys()];
    expect(keys).toContain('/rp/assets/minecraft/textures/entity/equipment/humanoid_leggings/cat_legs_0.png');
    const def = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/cat_legs.json'));
    expect(Array.isArray(def.layers.humanoid_leggings)).toBe(true);
    expect(def.layers.humanoid_leggings.length).toBe(2);
  });

  it('uses the custom_model_data name (cmdName), not the project name, for equipment assets', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(makeResult(1), {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, equipmentSlot: 'head', cmdName: 'My Cat',
    });
    const keys = [...memfs.writes.keys()];
    // 'My Cat' sanitizes to 'my_cat'; slot appended -> my_cat_head
    expect(keys).toContain('/rp/assets/minecraft/equipment/my_cat_head.json');
    expect(keys).toContain('/rp/assets/minecraft/textures/entity/equipment/humanoid/my_cat_head_0.png');
    const give = memfs.writes.get('/rp/assets/minecraft/equipment/my_cat_head_give.txt');
    expect(give).toContain('asset_id:"minecraft:my_cat_head"');
  });

  it('piece mode: chestplate def spans body+arms, each face stamped with its own part', async () => {
    const { api, memfs } = setup();
    const r = makeResult(3);
    r.faceGroups = ['body', 'right_arm', 'left_arm']; // face k -> part (name fallback)
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const def = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/cat_chestplate.json'));
    expect(def.layers.humanoid.length).toBe(3);
    const wantPart = [0, 2, 3]; // body, right_arm, left_arm
    for (let k = 0; k < 3; k++) {
      const dec = PNG.sync.read(Buffer.from(
        memfs.writes.get(`/rp/assets/minecraft/textures/entity/equipment/humanoid/cat_chestplate_${k}.png`)));
      expect(dec.data[34], `face ${k} part`).toBe(wantPart[k]);
      expect(dec.data[3]).toBe(253);
    }
    const give = memfs.writes.get('/rp/assets/minecraft/equipment/cat_chestplate_give.txt');
    expect(give).toContain('leather_chestplate');
    expect(give).toContain('slot:"chest"');
  });

  it('piece mode: a full-set model partitions across pieces (each gets only its parts)', async () => {
    const { api, memfs } = setup();
    const r = makeResult(5);
    r.faceGroups = ['head', 'body', 'right_arm', 'right_leg', 'right_foot']; // parts 1,0,2,4,6
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat',
      selectedPieces: ['helmet', 'chestplate', 'leggings', 'boots'],
    });
    const def = k => JSON.parse(memfs.writes.get(`/rp/assets/minecraft/equipment/cat_${k}.json`));
    expect(def('helmet').layers.humanoid.length).toBe(1);            // head
    expect(def('chestplate').layers.humanoid.length).toBe(2);        // body + right_arm
    expect(def('leggings').layers.humanoid_leggings.length).toBe(1); // right_leg
    expect(def('boots').layers.humanoid.length).toBe(1);             // right_foot
  });

  it('piece mode: duplicate element names resolve by OBJ block order (the real bug)', async () => {
    // Two cubes both literally named "cube" (BB default) under part-tagged groups.
    // The name-keyed map collided them (-> all one part); block order must not.
    class Cube { constructor(name, parent) { this.name = name; this.parent = parent; } }
    const bodyG = { name: 'g0', objcubed_body_part: 0, parent: 'root', children: [] };
    const armG  = { name: 'g1', objcubed_body_part: 2, parent: 'root', children: [] };
    const c0 = new Cube('cube', bodyG); bodyG.children.push(c0);
    const c1 = new Cube('cube', armG);  armG.children.push(c1);

    const memfs = makeMemFs();
    const { api } = loadObjcubedWithContext({
      globals: {
        Buffer,
        Blockbench: { export() { throw new Error('dialog'); }, pickDirectory() { return '/rp'; } },
        Project: { name: 'cat', export_path: '' },
        BarItems: {},
        Outliner: { root: [bodyG, armG] },
        Cube,
      },
      requireImpl: id => id === 'fs' ? memfs : id === 'path' ? posixPath : require(id),
    });

    const r = makeResult(12);
    r.faceGroups = Array(12).fill('cube');        // all same name (collision bait)
    r.faceBlocks = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]; // 6 faces per cube, in order
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const def = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/cat_chestplate.json'));
    expect(def.layers.humanoid.length).toBe(12);  // body(0) + arm(2) both in chestplate
    const want = [0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2];
    for (let k = 0; k < 12; k++) {
      const dec = PNG.sync.read(Buffer.from(
        memfs.writes.get(`/rp/assets/minecraft/textures/entity/equipment/humanoid/cat_chestplate_${k}.png`)));
      expect(dec.data[34], `face ${k}`).toBe(want[k]);
    }
  });

  it('centering: X/Z centered, Y dropped to base (min) — off-origin & off-height no drift', () => {
    const { api } = setup();
    // Two single-face "cubes": quad a low, quad b far sideways AND high (base at Y=20).
    const obj = [
      'o a', 'v 10 0 0', 'v 11 0 0', 'v 11 1 0', 'v 10 1 0', 'f 1 2 3 4',
      'o b', 'v 0 20 0', 'v 1 20 0', 'v 1 21 0', 'v 0 21 0', 'f 5 6 7 8',
    ].join('\n');
    const f0 = api.parseObj(obj, 0);
    const faceToPart = [0, 2];                       // face 0 -> body, face 1 -> right_arm
    const partRef = api.computePartCenters(f0, faceToPart);
    expect(partRef.get(0)).toEqual([10.5, 0, 0]);   // X/Z center, Y = base (min)
    expect(partRef.get(2)).toEqual([0.5, 20, 0]);   // quad b base at 20 -> dropped to 0
    const { data } = api.buildVertexData([obj], null, partRef, faceToPart);
    for (const p of data.positions) {
      expect(Math.abs(p[0])).toBeLessThanOrEqual(0.5 + 1e-9); // X centered
      expect(p[1]).toBeGreaterThanOrEqual(-1e-9);             // base on 0 ...
      expect(p[1]).toBeLessThanOrEqual(1 + 1e-9);             // ... height preserved (0..1)
    }
    // Without centering (item path): raw BB coords preserved (no regression).
    const raw = api.buildVertexData([obj], null, null, null);
    expect(raw.data.positions.some(p => p.some(c => Math.abs(c) > 5))).toBe(true);
  });

  it('group body-part tags round-trip through collect/apply (persistence fix)', () => {
    // BB drops custom Group properties on save; the plugin persists them itself.
    const groups = [
      { uuid: 'u-body', objcubed_body_part: 0 },   // 0 is a valid part (must NOT be dropped as falsy)
      { uuid: 'u-rarm', objcubed_body_part: 2 },
      { uuid: 'u-untagged' },
    ];
    const memfs = makeMemFs();
    const { api } = loadObjcubedWithContext({
      globals: {
        Buffer,
        Blockbench: { export() {}, pickDirectory() { return '/rp'; } },
        Project: {}, BarItems: {},
        Group: { all: groups },
      },
      requireImpl: id => id === 'fs' ? memfs : id === 'path' ? posixPath : require(id),
    });
    const map = api.collectBodyPartTags();
    expect(map).toEqual({ 'u-body': 0, 'u-rarm': 2 }); // tagged kept (incl. 0); untagged excluded
    // simulate reload dropping the in-memory props, then restore from the saved map
    groups.forEach(g => delete g.objcubed_body_part);
    api.applyBodyPartTags(map);
    expect(groups[0].objcubed_body_part).toBe(0);
    expect(groups[1].objcubed_body_part).toBe(2);
    expect(groups[2].objcubed_body_part).toBeUndefined(); // not in map -> stays untagged
  });

  it('armor: part-encoded tokens classify each face by ITS element, order-independent', () => {
    const { api } = setup();
    // tokens as applyPartTokenNames writes them: ocp<part+1>e<emis>i<idx>
    expect(api.parseFaceToken('ocp1e0i0')).toEqual({ part: 0, emis: 0 });   // body
    expect(api.parseFaceToken('ocp3e5i7')).toEqual({ part: 2, emis: 5 });   // right_arm + emissive 5
    expect(api.parseFaceToken('ocp8e0i9')).toEqual({ part: 7, emis: 0 });   // left_foot
    expect(api.parseFaceToken('ocp0e0i1')).toEqual({ part: -1, emis: 0 });  // untagged (part+1=0)
    expect(api.parseFaceToken('cube')).toBeNull();
    // buildFaceToPart takes the token branch and reads each face's own part — the OBJ
    // emit order (which scrambled the old block-order classifier) no longer matters.
    const faceGroups = ['ocp1e0i0', 'ocp3e0i1', 'ocp4e0i2', 'cube'];
    expect(api.buildFaceToPart(faceGroups, null)).toEqual([0, 2, 3, -1]);
  });

  it('centering: a set group pivot overrides bbox-center as the attach reference', () => {
    const groups = [{ uuid: 'g0', objcubed_body_part: 0, origin: [16, 32, 0] }]; // pivot at block (1,2,0)
    const memfs = makeMemFs();
    const { api } = loadObjcubedWithContext({
      globals: {
        Buffer,
        Blockbench: { export() {}, pickDirectory() { return '/rp'; } },
        Project: {}, BarItems: {},
        Group: { all: groups },
      },
      requireImpl: id => id === 'fs' ? memfs : id === 'path' ? posixPath : require(id),
    });
    const obj = ['o a', 'v 10 0 0', 'v 11 0 0', 'v 11 1 0', 'v 10 1 0', 'f 1 2 3 4'].join('\n');
    const f0 = api.parseObj(obj, 0);
    const ref = api.computePartCenters(f0, [0]);
    expect(ref.get(0)).toEqual([1, 2, 0]); // group origin/16, NOT the bbox-center (10.5,0,0)
  });

  it('REGRESSION: exportAsEquipment=false writes NO equipment files', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(makeResult(3), {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: false,
    });
    const keys = [...memfs.writes.keys()];
    expect(keys.some(p => p.startsWith('/rp/assets/minecraft/equipment/'))).toBe(false);
    expect(keys.some(p => p.startsWith('/rp/assets/minecraft/textures/entity/equipment/'))).toBe(false);
  });
});
