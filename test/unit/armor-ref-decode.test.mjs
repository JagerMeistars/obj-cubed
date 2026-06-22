// Tests for the CPU-side armor "reference decoder" (test/helpers/armor-ref-decode.cjs),
// which faithfully replicates the shader's per-limb armor decode + world-Pos
// reconstruction so the pipeline can be exercised without a GPU / Minecraft.
//
// Coverage (mirrors the bug classes the real pipeline actually hit):
//  - Header round-trip: encode via saveSingleOutput, decode with the reference
//    decoder, assert nboxes / per-face indices / part / emissive match what was
//    packed. (Catches "meta read loop too short → t[11..13] garbage": the decoder
//    reads at the SAME texel offsets the encoder writes.)
//  - Anchor/overlay invariant: SOUTH/WEST/EAST world Pos == NORTH world Pos for the
//    same model offset, for body/head/all limbs (L+R), under a non-trivial bone
//    rotation+translation AND armor-layer inflation (grow 0/0.5/1). (~1e-15.)
//  - Packing/layer-count: N faces → ceil(N/4) layers, right face→slot assignment.
//  - Emissive: a face with light_emission>0 sets the emissive byte and the decoder
//    flags it fullbright.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { makeMemFs } = require('../helpers/mem-fs.cjs');
const ref = require('../helpers/armor-ref-decode.cjs');
const nodePath = require('node:path');
const { PNG } = require('pngjs');

const posixPath = { ...nodePath, ...nodePath.posix };

const TW = 24;
const TY = 2;

// Same synthetic full-texture seed the existing equipment tests use: marker at
// pixel 0, wide enough (tw>=23) that the packed header texels 8..22 live in row 0.
function makeResult(nfaces) {
  const rawBuf = Buffer.alloc(TW * TY * 4);
  rawBuf[0] = 12; rawBuf[1] = 34; rawBuf[2] = 56; rawBuf[3] = 255;
  return {
    pngBuffer: Buffer.from([1, 2, 3]),
    rawBuf, elements: [], nfaces, nframes: 1, tw: TW, ty: TY,
  };
}

function setup() {
  const memfs = makeMemFs();
  const { api } = loadObjcubedWithContext({
    globals: {
      Buffer,
      Blockbench: { export() { throw new Error('dialog'); }, pickDirectory() { return '/rp'; } },
      Project: { name: 'cat', export_path: '' },
      BarItems: {},
    },
    requireImpl: id => (id === 'fs' ? memfs : id === 'path' ? posixPath : require(id)),
  });
  return { api, memfs };
}

const EQ_TEX_DIR = '/rp/assets/minecraft/textures/entity/equipment/humanoid';

// ---------------------------------------------------------------------------
// 1. HEADER ROUND-TRIP — decode a real export and compare to what was packed.
// ---------------------------------------------------------------------------
describe('armor-ref-decode: header round-trip (encoder ↔ reference decoder)', () => {
  it('legacy chest: decodes marker / nboxes / per-face indices / part from the exported PNG', async () => {
    const { api, memfs } = setup();
    await api.saveSingleOutput(makeResult(3), {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, equipmentSlot: 'chest',
    });
    const png = memfs.writes.get(`${EQ_TEX_DIR}/cat_chest_0.png`);
    const h = ref.decodeArmorHeader(png);

    expect(h.isArmor).toBe(true);
    expect(h.marker).toBe(253);
    expect(h.nboxes).toBe(3);
    // chest carrier [r_arm, l_arm, body]; whole model rides the BODY box (abody 2):
    // north@0, south@1, west@2, east=null. Arms empty.
    expect(h.boxes[2]).toMatchObject({ north: 0, south: 1, west: 2, east: null, part: 0 });
    expect(h.boxes[0].north).toBeNull();
    expect(h.boxes[1].north).toBeNull();
  });

  it('per-limb: each part decodes to its carrier box (abody) with the right part id', async () => {
    const PARTS = [
      { slot: 'chest',      layer: 'humanoid',          id: 0, nboxes: 3, abody: 2 },
      { slot: 'head',       layer: 'humanoid',          id: 1, nboxes: 2, abody: 0 },
      { slot: 'right_arm',  layer: 'humanoid',          id: 2, nboxes: 3, abody: 0 },
      { slot: 'left_arm',   layer: 'humanoid',          id: 3, nboxes: 3, abody: 1 },
      { slot: 'right_leg',  layer: 'humanoid_leggings', id: 4, nboxes: 3, abody: 1 },
      { slot: 'left_leg',   layer: 'humanoid_leggings', id: 5, nboxes: 3, abody: 0 },
      { slot: 'right_foot', layer: 'humanoid',          id: 6, nboxes: 2, abody: 1 },
      { slot: 'left_foot',  layer: 'humanoid',          id: 7, nboxes: 2, abody: 0 },
    ];
    for (const p of PARTS) {
      const { api, memfs } = setup();
      await api.saveSingleOutput(makeResult(1), {}, {
        resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
        exportAsEquipment: true, equipmentSlot: p.slot,
      });
      const png = memfs.writes.get(
        `/rp/assets/minecraft/textures/entity/equipment/${p.layer}/cat_${p.slot}_0.png`);
      const h = ref.decodeArmorHeader(png);
      expect(h.nboxes, `${p.slot} nboxes`).toBe(p.nboxes);
      expect(h.boxes[p.abody], `${p.slot} box`).toMatchObject(
        { north: 0, south: null, west: null, east: null, part: p.id });
    }
  });

  // The exact bug class called out in the brief: if the decoder's read offsets /
  // loop bound disagreed with the encoder's write offsets, t[11..13] (south) and
  // texels 14..22 (west/east/emissive) would read garbage. This test cross-checks
  // the reference decoder against a hand-decode at the encoder's literal byte
  // offsets, so any drift in either side fails.
  it('read offsets agree byte-for-byte with the encoder write offsets (t[11..13]/14+/17+/20+)', async () => {
    const { api, memfs } = setup();
    const r = makeResult(8);
    // 8 faces on the body box → 2 layers (N/S/W/E then N/S). Use layer 0: all 4 set.
    r.faceGroups = ['body', 'body', 'body', 'body', 'body', 'body', 'body', 'body'];
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const png = memfs.writes.get(`${EQ_TEX_DIR}/cat_chestplate_0.png`);
    const raw = PNG.sync.read(Buffer.from(png)).data;
    const h = ref.decodeArmorHeader(png);

    // hand-decode at the encoder's literal texel offsets (writePackedLayer):
    const rd16 = (texel) => { const v = raw[texel * 4] * 256 + raw[texel * 4 + 1]; return v === 65535 ? null : v; };
    for (let abody = 0; abody < h.nboxes; abody++) {
      expect(h.boxes[abody].north, `box${abody} north`).toBe(rd16(8 + abody));
      expect(h.boxes[abody].part,  `box${abody} part`).toBe(raw[(8 + abody) * 4 + 2]);
      expect(h.boxes[abody].south, `box${abody} south`).toBe(rd16(11 + abody)); // t[11..13] — the bug
      expect(h.boxes[abody].west,  `box${abody} west`).toBe(rd16(14 + abody));
      expect(h.boxes[abody].east,  `box${abody} east`).toBe(rd16(17 + abody));
      expect(h.boxes[abody].emis.n, `box${abody} emisN`).toBe(raw[(20 + abody) * 4 + 0]);
      expect(h.boxes[abody].emis.s, `box${abody} emisS`).toBe(raw[(20 + abody) * 4 + 1]);
      expect(h.boxes[abody].emis.w, `box${abody} emisW`).toBe(raw[(20 + abody) * 4 + 2]);
      expect(h.boxes[abody].emis.e, `box${abody} emisE`).toBe(raw[(20 + abody) * 4 + 3]);
    }
    // The body box on layer 0 must carry all four faces (proves S/W/E are NOT garbage).
    const body = h.boxes[2];
    expect(body.north).not.toBeNull();
    expect(body.south).not.toBeNull();
    expect(body.west).not.toBeNull();
    expect(body.east).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. ANCHOR / OVERLAY INVARIANT — S/W/E world Pos == NORTH world Pos.
// ---------------------------------------------------------------------------
describe('armor-ref-decode: anchor/overlay invariant (S/W/E overlay NORTH to ~1e-15)', () => {
  // [name, W, H, D, mirror(left), partId]
  const PARTS = [
    ['body',   8, 12, 4, false, 0],
    ['head',   8, 8,  8, false, 1],
    ['r_arm',  4, 12, 4, false, 2],
    ['l_arm',  4, 12, 4, true,  3],
    ['r_leg',  4, 12, 4, false, 4],
    ['l_leg',  4, 12, 4, true,  5],
    ['r_foot', 4, 12, 4, false, 6],
    ['l_foot', 4, 12, 4, true,  7],
  ];
  const F6FACE = { SOUTH: 5, WEST: 2, EAST: 4 };
  // Non-trivial bone pose: arbitrary-axis rotation + translation.
  const R = ref.rotAxis([0.3, 1, 0.5], 0.9);
  const T = [1.5, -0.7, 2.2];
  const MODEL_OFFSETS = [[1, 2, -3], [0, 0, 0], [-2, 3, 1], [3, -1, 2]];

  for (const grow of [0, 0.5, 1]) {
    for (const [name, W, H, D, left, part] of PARTS) {
      for (const fname of ['SOUTH', 'WEST', 'EAST']) {
        it(`${name} ${fname} overlays NORTH (grow ${grow}, ${left ? 'left' : 'right'})`, () => {
          const qn = ref.carrierQuad({ W, H, D, grow, mirror: left, face: 'NORTH', R, T });
          const qf = ref.carrierQuad({ W, H, D, grow, mirror: left, face: fname, R, T });
          for (const m of MODEL_OFFSETS) {
            const pNorth = ref.faceWorldPos(qn, 3, left, part, m);
            const pFace  = ref.faceWorldPos(qf, F6FACE[fname], left, part, m);
            expect(ref.len(ref.sub(pNorth, pFace))).toBeLessThan(1e-9);
          }
        });
      }
    }
  }

  it('the invariant is non-vacuous: a WRONG anchor breaks it (sanity guard)', () => {
    // If we packed a SOUTH model offset onto the NORTH carrier face directly (no
    // C_F / re-anchor), it must NOT overlay — proving the test would catch a regression.
    const qn = ref.carrierQuad({ W: 8, H: 12, D: 4, grow: 0.5, face: 'NORTH', R, T });
    const qs = ref.carrierQuad({ W: 8, H: 12, D: 4, grow: 0.5, face: 'SOUTH', R, T });
    const m = [1, 2, -3];
    const correct = ref.faceWorldPos(qs, 5, false, 0, m);          // SOUTH face, proper decode
    const naiveNorth = ref.faceWorldPos(qn, 3, false, 0, m);       // packed as NORTH instead
    // Treating the SOUTH carrier quad as if it were NORTH (wrong f6) drifts:
    const wrong = ref.faceWorldPos(qs, 3, false, 0, m);
    expect(ref.len(ref.sub(correct, naiveNorth))).toBeLessThan(1e-9); // proper S == N
    expect(ref.len(ref.sub(wrong, correct))).toBeGreaterThan(0.01);   // mislabel drifts
  });
});

// ---------------------------------------------------------------------------
// 3. PACKING / LAYER-COUNT — N faces → ceil(N/4) layers, right face→slot map.
// ---------------------------------------------------------------------------
describe('armor-ref-decode: packing / layer-count', () => {
  it('N faces on one box pack into ceil(N/4) layers (N/S/W/E per layer)', async () => {
    for (const N of [1, 3, 4, 5, 8, 9]) {
      const { api, memfs } = setup();
      const r = makeResult(N);
      r.faceGroups = Array(N).fill('body');
      await api.saveSingleOutput(r, {}, {
        resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
        exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
      });
      const def = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/cat_chestplate.json'));
      const expected = Math.ceil(N / 4);
      expect(def.layers.humanoid.length, `N=${N}`).toBe(expected);

      // Verify face→slot assignment via the reference decoder for every layer.
      for (let L = 0; L < expected; L++) {
        const png = memfs.writes.get(`${EQ_TEX_DIR}/cat_chestplate_${L}.png`);
        const h = ref.decodeArmorHeader(png);
        const body = h.boxes[2]; // chest carrier [r_arm,l_arm,body]
        // Expected indices for the body box on layer L: 4L..4L+3 (clamped to N, else null).
        const exp = j => { const k = 4 * L + j; return k < N ? k : null; };
        expect(body.north, `N=${N} L=${L} north`).toBe(exp(0));
        expect(body.south, `N=${N} L=${L} south`).toBe(exp(1));
        expect(body.west,  `N=${N} L=${L} west`).toBe(exp(2));
        expect(body.east,  `N=${N} L=${L} east`).toBe(exp(3));
      }
    }
  });

  it('chestplate packs body+arms (3 boxes) into ONE layer; decoder reads each box', async () => {
    const { api, memfs } = setup();
    const r = makeResult(3);
    r.faceGroups = ['body', 'right_arm', 'left_arm']; // parts 0,2,3
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const def = JSON.parse(memfs.writes.get('/rp/assets/minecraft/equipment/cat_chestplate.json'));
    expect(def.layers.humanoid.length).toBe(1);
    const h = ref.decodeArmorHeader(memfs.writes.get(`${EQ_TEX_DIR}/cat_chestplate_0.png`));
    // carrier order [r_arm(2), l_arm(3), body(0)], one face each → north only.
    expect(h.boxes[0]).toMatchObject({ north: 1, part: 2, south: null, west: null, east: null }); // r_arm
    expect(h.boxes[1]).toMatchObject({ north: 2, part: 3, south: null, west: null, east: null }); // l_arm
    expect(h.boxes[2]).toMatchObject({ north: 0, part: 0, south: null, west: null, east: null }); // body
  });
});

// ---------------------------------------------------------------------------
// 4. EMISSIVE — light_emission>0 sets the byte; the decoder flags fullbright.
// ---------------------------------------------------------------------------
describe('armor-ref-decode: per-face emissive', () => {
  it('bakes per-face emissive into texel 20+abody and the decoder flags fullbright', async () => {
    const { api, memfs } = setup();
    const r = makeResult(3);
    r.faceGroups = ['body', 'right_arm', 'left_arm']; // parts 0,2,3
    r.faceEmission = [7, 0, 15];                       // face0(body)=7, face1(r_arm)=0, face2(l_arm)=15
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const h = ref.decodeArmorHeader(memfs.writes.get(`${EQ_TEX_DIR}/cat_chestplate_0.png`));
    // carrier [r_arm(abody0,face1), l_arm(abody1,face2), body(abody2,face0)] — each on NORTH.
    expect(h.boxes[0].emis.n).toBe(0);  // r_arm north = face1 → 0
    expect(h.boxes[1].emis.n).toBe(15); // l_arm north = face2 → 15
    expect(h.boxes[2].emis.n).toBe(7);  // body  north = face0 → 7

    // "fullbright" flag = the shader's `if (aemis > 0) noshadow = 1`.
    const fullbright = lvl => lvl > 0;
    expect(fullbright(h.boxes[0].emis.n)).toBe(false); // r_arm not emissive
    expect(fullbright(h.boxes[1].emis.n)).toBe(true);  // l_arm emissive
    expect(fullbright(h.boxes[2].emis.n)).toBe(true);  // body emissive
  });

  it('a non-emissive layer leaves all emissive bytes 0 (no false fullbright)', async () => {
    const { api, memfs } = setup();
    const r = makeResult(3);
    r.faceGroups = ['body', 'right_arm', 'left_arm'];
    await api.saveSingleOutput(r, {}, {
      resourcePackDir: '/rp', baseItem: 'iron_ingot', generateDatapack: false,
      exportAsEquipment: true, cmdName: 'cat', selectedPieces: ['chestplate'],
    });
    const h = ref.decodeArmorHeader(memfs.writes.get(`${EQ_TEX_DIR}/cat_chestplate_0.png`));
    for (const box of h.boxes) {
      for (const f6 of [2, 3, 4, 5]) {
        const key = { 3: 'n', 5: 's', 2: 'w', 4: 'e' }[f6];
        expect(box.emis[key]).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. GLSL TOOL PORTS — getpos/getuv/getvert codec round-trip (the data section).
// ---------------------------------------------------------------------------
describe('armor-ref-decode: getpos/getuv/getvert codec parity', () => {
  // Build a 1-row data block matching the encoder (posPixels/uvPixels/vertPixels)
  // and confirm the reference getters decode it back. This guards the vertex-data
  // read path the armor block uses (decodeModelFaceOffsets).
  const u24 = v => [Math.trunc(v / 65536) & 255, Math.trunc(v / 256) & 255, Math.trunc(v) & 255];
  function posPixels(p) { return p.map(v => [...u24(8388608 + v * 65536), 255]); } // scale 1, off 0

  it('getpos decodes the encoder posPixels codec to ~1e-6', () => {
    const W = 16, H = 4;
    const positions = [[-1.5, 0, 0.5], [7.25, -32, 1]];
    const data = new Uint8Array(W * (H + positions.length * 3) * 4); // header rows unused here
    // write positions starting at row H (h param), 3 pixels per position, row-major.
    positions.forEach((p, i) => {
      posPixels(p).forEach((px, j) => {
        const idx = i * 3 + j;
        const x = idx % W, y = H + Math.floor(idx / W);
        const o = (y * W + x) * 4;
        data[o] = px[0]; data[o + 1] = px[1]; data[o + 2] = px[2]; data[o + 3] = 255;
      });
    });
    const tex = ref.makeTexture({ data, width: W, height: H + positions.length * 3 });
    positions.forEach((p, i) => {
      const dec = ref.getpos(tex, [0, 0], W, H, i);
      for (let a = 0; a < 3; a++) expect(Math.abs(dec[a] - p[a])).toBeLessThan(1e-6);
    });
  });

  it('getvert decodes a 24-bit index pair', () => {
    const W = 8, H = 0;
    const verts = [[5, 9], [100000, 7]];
    const data = new Uint8Array(W * (verts.length * 2) * 4);
    verts.forEach((vt, i) => {
      [[...u24(vt[0]), 255], [...u24(vt[1]), 255]].forEach((px, j) => {
        const idx = i * 2 + j;
        const x = idx % W, y = Math.floor(idx / W);
        const o = (y * W + x) * 4;
        data[o] = px[0]; data[o + 1] = px[1]; data[o + 2] = px[2]; data[o + 3] = 255;
      });
    });
    const tex = ref.makeTexture({ data, width: W, height: verts.length * 2 });
    verts.forEach((vt, i) => {
      const dec = ref.getvert(tex, [0, 0], W, H, i);
      expect(dec[0]).toBe(vt[0]);
      expect(dec[1]).toBe(vt[1]);
    });
  });
});
