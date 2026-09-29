// Easing (animation interpolation curves): the export packs a 4-bit per-animation
// easing index into header texel t[4].a, split across the two free bit-regions of
// that byte (low 2 bits at 4..5, high 2 bits at 0..1). This test drives the REAL
// buildOutput and decodes t[4].a exactly the way objmc_main.glsl does, asserting:
//   (1) all six modes (0..5) round-trip through the packed byte,
//   (2) legacy modes 0..3 leave the high bits (0..1) ZERO, so any pre-existing PNG
//       stays byte-identical under the new 4-bit reader (backward compatibility),
//   (3) autoplay + the legacy interpolation nibble are undisturbed by the split,
//   (4) the ease(mode,t) curve (ported from objmc_tools.glsl) has the right shape.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SRC = path.join(REPO_ROOT, 'objcubed.js');
const CODE = fs.readFileSync(SRC, 'utf8');

const TW = 16, TH = 16;

// Minimal DOM/Image stub so getTextureRGBA has a source to read (same shape as
// tex-anim-header.test.mjs). A solid 16x16 texture is all a static export needs.
function loadPlugin() {
  const mod = { exports: {} };
  const data = new Uint8Array(TW * TH * 4).fill(255);
  class FakeImage {
    set src(_v) { setTimeout(() => this.onload && this.onload(), 0); }
    get naturalWidth() { return TW; } get naturalHeight() { return TH; }
    get width() { return TW; } get height() { return TH; }
  }
  const ctx = { drawImage() {}, getImageData() { return { data, width: TW, height: TH }; } };
  const document = { createElement() { return { getContext() { return ctx; }, set width(_v) {}, set height(_v) {} }; } };
  const sandbox = {
    console, require, module: mod, exports: mod.exports,
    Buffer, setTimeout, process,
    BBPlugin: { register() {} }, Plugin: { register() {} },
    settings: { language: { value: 'en' } },
    Image: FakeImage, document,
    Texture: { all: [{ uuid: 'u', name: 't', source: 'data:fake', img: { src: 'data:fake' } }] },
    Outliner: { root: [] },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: SRC });
  return mod.exports.__test;
}

const OBJ = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
  'usemtl m_u',
  'f 1/1 2/2 3/3 4/4',
].join('\n');

function baseCfg(extra) {
  return {
    texIndex: 0, nopow: false, scale: 1, offset: [0, 0, 0],
    colorbehavior: ['direct', 'direct', 'direct'], duration: 0,
    autoplay: false, easing: 0, interpolation: 0, noshadow: false,
    autorotate: 0, visibility: 7, displaySlots: {}, flipuv: false,
    useAtlas: false,
    texAnimEnabled: false, texFrametime: 1, texFade: false,
    ...extra,
  };
}

// Read header texel t[4].a from the produced buffer.
function t4a(res) {
  const { tw, rawBuf } = res;
  return rawBuf[(0 * tw + 4) * 4 + 3];
}

// Decode the byte the way objmc_main.glsl does.
function decode(a) {
  return {
    version:  (a >> 7) & 1,
    autoplay: (a >> 6) & 1,
    interp:   (a >> 2) & 3,                       // legacy nibble (shader-dead)
    easing:   ((a >> 4) & 3) | ((a & 3) << 2),    // 4-bit index, low@4..5 high@0..1
    highBits: a & 3,
  };
}

// JS port of ease(int m, float t) from objmc_tools.glsl (curve-shape assertion).
function ease(m, t) {
  if (m === 1) return t;
  if (m === 2) return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) * 0.5;
  if (m === 4) return t * t;
  if (m === 5) return 1 - (1 - t) * (1 - t);
  return 0; // 0 step/hold, 3 catmull-rom (handled by caller), unknown -> hold
}

describe('easing: 4-bit per-animation index packed in header t[4].a', () => {
  it('round-trips all six modes (0..5) through the packed byte', async () => {
    const api = loadPlugin();
    for (let mode = 0; mode <= 5; mode++) {
      const res = await api.buildOutput(baseCfg({ easing: mode, interpolation: 1 }), [OBJ], '');
      const d = decode(t4a(res));
      expect(d.version).toBe(1);        // version/marker bit always set
      expect(d.easing).toBe(mode);      // decodes back to what we asked for
      expect(d.interp).toBe(1);         // legacy interpolation nibble undisturbed
    }
  });

  it('legacy modes 0..3 keep the high bits ZERO (byte-identical to old encoder)', async () => {
    const api = loadPlugin();
    for (let mode = 0; mode <= 3; mode++) {
      const res = await api.buildOutput(baseCfg({ easing: mode, interpolation: 2 }), [OBJ], '');
      const a = t4a(res);
      // Old encoder byte was 128 | autoplay<<6 | easing<<4 | interpolation<<2.
      const legacy = 128 | (0 << 6) | (mode << 4) | (2 << 2);
      expect(a).toBe(legacy);           // exact legacy layout for the classic range
      expect(a & 3).toBe(0);            // high easing bits stay 0 -> backward compatible
    }
  });

  it('new modes 4,5 use the high bits without touching autoplay/interp', async () => {
    const api = loadPlugin();
    for (const mode of [4, 5]) {
      const res = await api.buildOutput(baseCfg({ easing: mode, autoplay: true, interpolation: 3 }), [OBJ], '');
      const d = decode(t4a(res));
      expect(d.easing).toBe(mode);
      expect(d.highBits).toBe((mode >> 2) & 3); // 1 for modes 4..7
      expect(d.autoplay).toBe(1);
      expect(d.interp).toBe(3);
    }
  });

  it('ease(mode,t) curve shapes: endpoints, midpoints, monotonicity', () => {
    // Endpoints: every non-hold curve pins 0->0 and 1->1.
    for (const m of [1, 2, 4, 5]) {
      expect(ease(m, 0)).toBeCloseTo(0);
      expect(ease(m, 1)).toBeCloseTo(1);
    }
    // Hold (0) and unknown fall back to 0 for every t (frame stays put).
    expect(ease(0, 0.3)).toBe(0);
    expect(ease(0, 0.9)).toBe(0);
    // Linear is the identity.
    expect(ease(1, 0.37)).toBeCloseTo(0.37);
    // In-out cubic is symmetric about (0.5, 0.5).
    expect(ease(2, 0.5)).toBeCloseTo(0.5);
    expect(ease(2, 0.25) + ease(2, 0.75)).toBeCloseTo(1);
    // Ease-in-quad lags the diagonal (slow start), ease-out leads it (fast start).
    expect(ease(4, 0.5)).toBeCloseTo(0.25);
    expect(ease(5, 0.5)).toBeCloseTo(0.75);
    expect(ease(4, 0.5)).toBeLessThan(0.5);
    expect(ease(5, 0.5)).toBeGreaterThan(0.5);
    // Monotonic non-decreasing on [0,1] for all animated curves.
    for (const m of [1, 2, 4, 5]) {
      let prev = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const v = ease(m, i / 20);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
});
