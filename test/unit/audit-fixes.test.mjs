// Audit-fixes regression pins (bug-hunt 2026-07):
//  #2  texAnimEnabled is ignored (with a warning) when an atlas is built
//  #8  atlas remapUV clamps out-of-range UVs BEFORE remapping + flags a warning
//  #5  datapack summon references the equipment asset the export actually wrote
//  #11 player-target functions resolve the temp-stand selector at @s
//  #10 shader: 24-bit manual frame decode keeps bits 16-22
//  #6  shader: legacy armor marker 254 support removed
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadObjcubed, REPO_ROOT } = require('../helpers/load-plugin.cjs');

const SRC = path.join(REPO_ROOT, 'objcubed.js');
const CODE = fs.readFileSync(SRC, 'utf8');
const GLSL = fs.readFileSync(path.join(
  REPO_ROOT, 'objcubed', 'assets', 'minecraft', 'shaders', 'include', 'objmc_main.glsl'), 'utf8');

// ---- #8: buildVertexData pre-remap clamp ---------------------------------

const QUAD_TILED = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'vt 0 0', 'vt 1 0', 'vt 1 1.2', 'vt 0 1.2', // v=1.2 tiles past the frame
  'usemtl m_a',
  'f 1/1 2/2 3/3 4/4',
].join('\n');
const QUAD_OK = QUAD_TILED.replace(/1\.2/g, '1');

function atlasInfoStub() {
  // texture 'a' (16x16) stacked first in a 16x64 atlas
  return {
    materialToTexIdx: new Map([['m_a', 0]]),
    offsets: new Map([[0, { x: 0, y: 0, w: 16, h: 16 }]]),
    width: 16, height: 64,
  };
}

describe('#8 atlas UV clamp happens before remapping', () => {
  it('v=1.2 clamps to the texture frame (not into the neighbor region) and sets uvClamped', () => {
    const api = loadObjcubed();
    const res = api.buildVertexData([QUAD_TILED], atlasInfoStub(), null, null);
    expect(res.uvClamped).toBe(true);
    // clamped v=1 remaps to (1*16+0)/64 = 0.25; the unclamped 1.2 would give 0.3
    const vs = res.data.uvs.map(uv => uv[1]);
    expect(Math.max(...vs)).toBeCloseTo(0.25, 6);
  });

  it('in-range UVs remap unchanged and do NOT flag uvClamped', () => {
    const api = loadObjcubed();
    const res = api.buildVertexData([QUAD_OK], atlasInfoStub(), null, null);
    expect(res.uvClamped).toBe(false);
    expect(Math.max(...res.data.uvs.map(uv => uv[1]))).toBeCloseTo(0.25, 6);
  });
});

// ---- #5 / #11: datapack generation ---------------------------------------

describe('#5 datapack summon uses the exported equipment asset name', () => {
  it('legacy single-part export: summon references <model>_<slot>', () => {
    const api = loadObjcubed();
    const files = api.generateDatapackFiles(
      'walk', 8, 'mypack', 'equipment', 'chest', 'stick', 'mymodel', 'mymodel_chest');
    expect(files.get('data/mypack/function/walk/summon.mcfunction'))
      .toContain('asset_id:"minecraft:mymodel_chest"');
  });

  it('per-piece export (no override): summon keeps the <model>_<piece> default', () => {
    const api = loadObjcubed();
    const files = api.generateDatapackFiles(
      'walk', 8, 'mypack', 'equipment', 'chest', 'stick', 'mymodel');
    expect(files.get('data/mypack/function/walk/summon.mcfunction'))
      .toContain('asset_id:"minecraft:mymodel_chestplate"');
  });
});

describe('#11 player-target temp-stand commands execute at @s', () => {
  it('every line touching the distance-selected temp stand is positioned at @s', () => {
    const api = loadObjcubed();
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'player', 'mainhand');
    for (const fn of ['_apply_auto', '_apply_manual']) {
      const body = files.get(`data/objcubed/function/walk/zzz/${fn}.mcfunction`);
      for (const line of body.split('\n')) {
        if (line.includes('distance=..0.01') && !line.includes('summon'))
          expect(line, `${fn}: ${line}`).toMatch(/^execute at @s /);
      }
      // the fix actually applies: at least one such positioned line exists
      expect(body).toMatch(/^execute at @s run kill /m);
    }
  });
});

// ---- #2: texAnim gated off in atlas mode ---------------------------------

// Same vm-context harness as tex-anim-header.test.mjs, but with TWO textures
// so buildOutput actually builds an atlas.
function loadWithTwoTextures(tw, th) {
  const mod = { exports: {} };
  const solid = new Uint8Array(tw * th * 4).fill(128);
  class FakeImage {
    set src(_v) { setTimeout(() => this.onload && this.onload(), 0); }
    get naturalWidth() { return tw; }
    get naturalHeight() { return th; }
    get width() { return tw; }
    get height() { return th; }
  }
  const ctx = { drawImage() {}, getImageData() { return { data: solid, width: tw, height: th }; } };
  const document = { createElement() { return { getContext() { return ctx; }, set width(_v) {}, set height(_v) {} }; } };
  const sandbox = {
    console, require, module: mod, exports: mod.exports,
    Buffer, setTimeout, process,
    BBPlugin: { register() {} }, Plugin: { register() {} },
    settings: { language: { value: 'en' } },
    Image: FakeImage, document,
    Texture: { all: [
      { uuid: 'a', name: 'ta', source: 'data:fa', img: { src: 'data:fa' } },
      { uuid: 'b', name: 'tb', source: 'data:fb', img: { src: 'data:fb' } },
    ] },
    Outliner: { root: [] },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: SRC });
  return mod.exports.__test;
}

const TWO_MTL_OBJ = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
  'usemtl m_a', 'f 1/1 2/2 3/3 4/4',
  'usemtl m_b', 'f 1/1 2/2 3/3 4/4',
].join('\n');

describe('atlas base: non-strip atlas is not whole-texture-animated', () => {
  it('atlas of two 16x16 textures + texAnimEnabled: header stays ntextures=1, full atlas height', async () => {
    const api = loadWithTwoTextures(16, 16);
    const res = await api.buildOutput({
      texIndex: 0, nopow: false, scale: 1, offset: [0, 0, 0],
      colorbehavior: ['direct', 'direct', 'direct'], duration: 0,
      autoplay: false, easing: 0, interpolation: 0, noshadow: false,
      autorotate: 0, visibility: 7, displaySlots: {}, flipuv: false,
      useAtlas: true, atlasTexIndices: [0, 1],
      texAnimEnabled: true, texFrametime: 1, texFade: false,
    }, [TWO_MTL_OBJ], '');
    const { tw, rawBuf } = res;
    const rd = (x, y) => { const i = (y * tw + x) * 4; return [rawBuf[i], rawBuf[i + 1], rawBuf[i + 2], rawBuf[i + 3]]; };
    // t[3].a = ntextures; the atlas (16x32) must NOT be sliced into 2 "frames"
    expect(rd(3, 0)[3]).toBe(1);
    // size.y (t[1].b*256 + t[7].r) = full atlas height, not a frame height
    expect(rd(1, 0)[2] * 256 + rd(7, 0)[0]).toBe(32);
  });
});

// ---- #10 / #6: shader source pins ----------------------------------------

// Two textures with DIFFERENT dims, keyed by src, so one can be a frame strip.
function loadAtlasDims(dimsBySrc) {
  const mod = { exports: {} };
  let cur = null;
  class FakeImage {
    set src(v) { cur = v; setTimeout(() => this.onload && this.onload(), 0); }
    get naturalWidth() { return dimsBySrc[cur].w; }
    get naturalHeight() { return dimsBySrc[cur].h; }
    get width() { return dimsBySrc[cur].w; }
    get height() { return dimsBySrc[cur].h; }
  }
  const ctx = { drawImage() {}, getImageData() {
    const d = dimsBySrc[cur];
    return { data: new Uint8Array(d.w * d.h * 4).fill(128), width: d.w, height: d.h };
  } };
  const document = { createElement() { return { getContext() { return ctx; }, set width(_v) {}, set height(_v) {} }; } };
  const sandbox = {
    console, require, module: mod, exports: mod.exports,
    Buffer, setTimeout, process,
    BBPlugin: { register() {} }, Plugin: { register() {} },
    settings: { language: { value: 'en' } },
    Image: FakeImage, document,
    Texture: { all: [
      { uuid: 'a', name: 'strip', source: 'data:strip', img: { src: 'data:strip' } },
      { uuid: 'b', name: 'flat', source: 'data:flat', img: { src: 'data:flat' } },
    ] },
    Outliner: { root: [] },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: SRC });
  return mod.exports.__test;
}

describe('atlas texture animation (strip inside a stitched atlas)', () => {
  it('16x32 strip (2 frames) stacked first + 16x16 static: header band + shader path', async () => {
    // strip 'a' (m_a) is stacked FIRST (offset y=0), static 'b' (m_b) after it.
    const api = loadAtlasDims({ 'data:strip': { w: 16, h: 32 }, 'data:flat': { w: 16, h: 16 } });
    const res = await api.buildOutput({
      texIndex: 0, nopow: false, scale: 1, offset: [0, 0, 0],
      colorbehavior: ['direct', 'direct', 'direct'], duration: 0,
      autoplay: false, easing: 0, interpolation: 0, noshadow: false,
      autorotate: 0, visibility: 7, displaySlots: {}, flipuv: false,
      useAtlas: true, atlasTexIndices: [0, 1],
      texAnimEnabled: true, texFrametime: 7, texFade: true,
    }, [TWO_MTL_OBJ], '');
    const { tw, rawBuf } = res;
    const rd = (x, y) => { const i = (y * tw + x) * 4; return [rawBuf[i], rawBuf[i + 1], rawBuf[i + 2], rawBuf[i + 3]]; };
    // ntextures stays 1 (the atlas is NOT whole-texture-animated)
    expect(rd(3, 0)[3]).toBe(1);
    // atlas is 16 wide, 32(strip)+16(flat) = 48 tall
    expect(rd(1, 0)[2] * 256 + rd(7, 0)[0]).toBe(48);
    // row-1 atlas-anim band: x=5 = (fade=1, enable=1); x=4 = frametime 7
    expect(rd(5, 1)[0]).toBe(1);                         // fade
    expect(rd(5, 1)[1]).toBe(1);                         // enable flag
    expect(rd(4, 1)[0] * 65536 + rd(4, 1)[1] * 256 + rd(4, 1)[2]).toBe(7); // frametime
    // band: the atlas stores regions V-FLIPPED, so image frame 0 (top) lives at
    // the BOTTOM of the strip region: y0 = off.y + off.h - frameH = 0+32-16 = 16.
    const y0 = rd(6, 1)[0] * 256 + rd(6, 1)[1];
    const fH = rd(6, 1)[2] * 256 + rd(7, 1)[0];
    const fc = rd(7, 1)[1];
    expect(y0).toBe(16);
    expect(fH).toBe(16);
    expect(fc).toBe(2);
  });

  it('atlas with NO strip texture + texAnimEnabled: band flag stays off (nothing animates)', async () => {
    const api = loadAtlasDims({ 'data:strip': { w: 16, h: 16 }, 'data:flat': { w: 16, h: 16 } });
    const res = await api.buildOutput({
      texIndex: 0, nopow: false, scale: 1, offset: [0, 0, 0],
      colorbehavior: ['direct', 'direct', 'direct'], duration: 0,
      autoplay: false, easing: 0, interpolation: 0, noshadow: false,
      autorotate: 0, visibility: 7, displaySlots: {}, flipuv: false,
      useAtlas: true, atlasTexIndices: [0, 1],
      texAnimEnabled: true, texFrametime: 1, texFade: false,
    }, [TWO_MTL_OBJ], '');
    const { tw, rawBuf } = res;
    const rd = (x, y) => { const i = (y * tw + x) * 4; return [rawBuf[i], rawBuf[i + 1], rawBuf[i + 2], rawBuf[i + 3]]; };
    expect(rd(5, 1)[1]).toBe(0); // enable flag off
  });

  it('BB-animated texture (uv_height = frame): vt is FRAME-relative and remaps into the frame-0 band', () => {
    // Texture marked animated in Blockbench: BB sets its UV size to one frame,
    // so the OBJ vt spans a single frame. remapUV must scale V by uvh and land
    // it in [off.y + off.h - uvh, off.y + off.h) — the stored frame-0 band.
    const api = loadObjcubed();
    const atlasInfo = {
      materialToTexIdx: new Map([['m_a', 0]]),
      // strip 16 wide, 32 tall (2 frames), first in a 48-tall atlas; uvh = 16
      offsets: new Map([[0, { x: 0, y: 0, w: 16, h: 32, uvh: 16 }]]),
      width: 16, height: 48,
    };
    const OBJ = [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', // full FRAME (not full strip)
      'usemtl m_a', 'f 1/1 2/2 3/3 4/4',
    ].join('\n');
    const res = api.buildVertexData([OBJ], atlasInfo, null, null);
    const vRows = res.data.uvs.map(uv => uv[1] * 48);
    // frame-0 band = [off.h - uvh, off.h) = [16, 32): v=0 -> 16, v=1 -> 32
    expect(Math.min(...vRows)).toBeCloseTo(16, 5);
    expect(Math.max(...vRows)).toBeCloseTo(32, 5);
  });

  it('plain texture (uvh == h) keeps the classic full-region remap', () => {
    const api = loadObjcubed();
    const atlasInfo = {
      materialToTexIdx: new Map([['m_a', 0]]),
      offsets: new Map([[0, { x: 0, y: 0, w: 16, h: 32, uvh: 32 }]]),
      width: 16, height: 48,
    };
    const OBJ = [
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
      'usemtl m_a', 'f 1/1 2/2 3/3 4/4',
    ].join('\n');
    const res = api.buildVertexData([OBJ], atlasInfo, null, null);
    const vRows = res.data.uvs.map(uv => uv[1] * 48);
    expect(Math.min(...vRows)).toBeCloseTo(0, 5);
    expect(Math.max(...vRows)).toBeCloseTo(32, 5);
  });

  it('shader has the atlas-anim sampling path (band-gated, steps UP per frame)', () => {
    expect(GLSL).toMatch(/aaf\.g == 1/);
    expect(GLSL).toMatch(/inBand/);
    expect(GLSL).toMatch(/-tf \* fH/); // flip-aware: frames step upward in storage
  });

  it('armor shader path re-adds the -0.5 vertical-origin re-anchor in model frame', () => {
    expect(GLSL).toMatch(/posoffset\.y \+= 0\.5;/);
  });
});

describe('shader decoder fixes', () => {
  it('#10 manual-frame decode keeps bits 16-22: (cR%128)*65536', () => {
    expect(GLSL).toMatch(/\(cR%128\)\*65536/);
    expect(GLSL).not.toMatch(/\(cR\*65536\)%32768/);
  });

  it('#6 legacy armor marker 254 is no longer accepted by the armor decoder', () => {
    expect(GLSL).not.toMatch(/am\.a == 254/);
    expect(GLSL).toMatch(/am\.a == 253/);
  });
});
