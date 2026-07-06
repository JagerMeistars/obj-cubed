// display-1:1 step A1/A2: encoder side.
//
// A1: buildOutput sets t[6].r bit 1 (hasStaticDisplay) when ANY world display
//     slot (thirdperson_*, head, ground, fixed, on_shelf) is non-identity, and
//     clears it for an all-identity world display. The shader skips autorotate
//     when this bit is set.
// A2: buildDisplayTransforms now KEEPS scale for firstperson (vanilla owns the
//     full hand transform); t[14]/t[15] are no longer hand-scale and stay 0.
//
// buildOutput needs the DOM texture path, so the plugin is loaded into its own
// vm context with Image/document/Texture stubs (same shape as tex-anim-header).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..', '..'
);
const SRC = path.join(REPO_ROOT, 'objcubed.js');
const CODE = fs.readFileSync(SRC, 'utf8');

// 16x16 solid RGBA texture. The 16-pixel header (t[0..15]) must fit in row 0,
// so the texture has to be >=16px wide or t[8..15] wrap into row 1.
const TW = 16, TH = 16;
function makeTex(w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 64; data[i + 2] = 32; data[i + 3] = 255; }
  return { data, width: w, height: h };
}

function loadWith() {
  const mod = { exports: {} };
  const tex = makeTex(TW, TH);
  class FakeImage {
    set src(_v) { setTimeout(() => this.onload && this.onload(), 0); }
    get naturalWidth() { return TW; } get naturalHeight() { return TH; }
    get width() { return TW; } get height() { return TH; }
  }
  const ctx = { drawImage() {}, getImageData() { return { data: tex.data, width: TW, height: TH }; } };
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

// One quad -> nfaces=1. usemtl m_u matches Texture.all[0].uuid.
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

// t[6].r byte from the encoded buffer (row 0, x=6, channel r).
function t6r(res) {
  const { tw, rawBuf } = res;
  return rawBuf[(0 * tw + 6) * 4 + 0];
}
function pixel(res, x, y) {
  const { tw, rawBuf } = res;
  const i = (y * tw + x) * 4;
  return [rawBuf[i], rawBuf[i + 1], rawBuf[i + 2], rawBuf[i + 3]];
}

describe('A1 encoder: hasStaticDisplay bit (t[6].r bit 1)', () => {
  it('IDENTITY world display: bit 1 is CLEAR, alpha stays 255', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({ displaySlots: {
      thirdperson_righthand: { rotation: [0,0,0], translation: [0,0,0], scale: [1,1,1] },
    } }), [OBJ], '');
    const b = t6r(res);
    expect((b >> 1) & 1).toBe(0);                 // gate clear
    expect(pixel(res, 6, 0)[3]).toBe(255);        // alpha preserved
  });

  it('NON-IDENTITY world display (thirdperson rotation): bit 1 is SET', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({ displaySlots: {
      thirdperson_righthand: { rotation: [0,45,0], translation: [0,0,0], scale: [1,1,1] },
    } }), [OBJ], '');
    expect((t6r(res) >> 1) & 1).toBe(1);
    expect(pixel(res, 6, 0)[3]).toBe(255);
  });

  it('NON-IDENTITY via head scale also sets bit 1', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({ displaySlots: {
      head: { rotation: [0,0,0], translation: [0,0,0], scale: [2,2,2] },
    } }), [OBJ], '');
    expect((t6r(res) >> 1) & 1).toBe(1);
  });

  it('a GUI-only / firstperson-only display does NOT set the world bit', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({ displaySlots: {
      gui:                   { rotation: [0,30,0], translation: [1,0,0], scale: [2,2,2] },
      firstperson_righthand: { rotation: [0,0,0], translation: [0,0,0], scale: [3,3,3] },
    } }), [OBJ], '');
    expect((t6r(res) >> 1) & 1).toBe(0);
  });

  it('setting the bit does not disturb the other t[6].r flags', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({
      noshadow: true, autorotate: 1, visibility: 7,
      displaySlots: { fixed: { translation: [4,0,0] } },
    }), [OBJ], '');
    const b = t6r(res);
    expect((b >> 7) & 1).toBe(1);   // noshadow
    expect((b >> 5) & 3).toBe(1);   // autorotate (2 bits)
    expect((b >> 2) & 7).toBe(7);   // visibility (3 bits)
    expect((b >> 1) & 1).toBe(1);   // hasStaticDisplay
  });
});

describe('A2/B encoder: t[14]/t[15] carry the q16 GUI pivot (block centre, not hand scale)', () => {
  it('default GUI pivot = block centre [0, 0, 0]; hand scale does NOT leak into t[14]/t[15]', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({ displaySlots: {
      firstperson_righthand: { scale: [3,3,3] },
      firstperson_lefthand:  { scale: [0.5,0.5,0.5] },
    } }), [OBJ], '');
    // Default GUI pivot = the BLOCK centre = the decoded-frame ORIGIN [0,0,0]
    // (the decoded model is block-centre relative) — vanilla's display pivot —
    // so a rotated icon matches the vanilla model (was: model bbox centre,
    // off vanilla under rotation/scale).
    // Step B layout: t[14]=(pxH,pxL,pyH), t[15]=(pyL,pzH,pzL). Decode + epsilon
    // (q16 over -128..128) instead of hardcoding rounding-sensitive bytes.
    const dec = (hi, lo) => (hi * 256 + lo) / 65535 * 256 - 128;
    const p14 = pixel(res, 14, 0), p15 = pixel(res, 15, 0);
    const EPS = 256 / 65535 + 1e-9;
    expect(Math.abs(dec(p14[0], p14[1]) - 0.0)).toBeLessThan(EPS); // pivot x
    expect(Math.abs(dec(p14[2], p15[0]) - 0.0)).toBeLessThan(EPS); // pivot y
    expect(Math.abs(dec(p15[1], p15[2]) - 0.0)).toBeLessThan(EPS); // pivot z
    expect(p14[3]).toBe(255);
    expect(p15[3]).toBe(255);
    // Hand scale stays OUT of t[14]/t[15] (it lives in model.json display now).
    // Dead row-1 hand rotation/translation pixels stay zeroed.
    expect(pixel(res, 0, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(res, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(res, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(res, 3, 1)).toEqual([0, 0, 0, 255]);
  });
});
