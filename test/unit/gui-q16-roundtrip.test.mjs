// display-1:1 step B: GUI header q16 round-trip.
//
// buildOutput now packs GUI scale/trans/rot/pivot at q16 (2 bytes/axis) into
// t[8..15], and stamps a GUI header version (2) in t[6].b. This test encodes a
// non-trivial GUI slot, decodes the header pixels with the SAME math the shader
// uses (objmc_main.glsl GUI block), and asserts the values round-trip within q16
// epsilon and that EVERY header pixel keeps alpha=255.
//
// buildOutput needs the DOM texture path, so the plugin is loaded into its own
// vm context with Image/document/Texture stubs (same shape as display-static-bit).
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

// 16px wide so the 16-pixel header (t[0..15]) fits in row 0 (t[8..15] would
// otherwise wrap into row 1 and get clobbered by the row-1 zeroing loop).
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

function pixel(res, x, y) {
  const { tw, rawBuf } = res;
  const i = (y * tw + x) * 4;
  return [rawBuf[i], rawBuf[i + 1], rawBuf[i + 2], rawBuf[i + 3]];
}

// Shader q16 decoders (high*256 + low) over the step-B layout.
function dec(res, hiPx, hiCh, loPx, loCh, min, max) {
  const a = pixel(res, hiPx, 0), b = pixel(res, loPx, 0);
  const u = a[hiCh] * 256 + b[loCh];
  return u / 65535 * (max - min) + min;
}
// channel index helper r=0,g=1,b=2
function decodeGui(res) {
  return {
    scale: [
      dec(res, 8, 0, 8, 1, 0, 4),   // sxH=t8.r, sxL=t8.g
      dec(res, 8, 2, 9, 0, 0, 4),   // syH=t8.b, syL=t9.r
      dec(res, 9, 1, 9, 2, 0, 4),   // szH=t9.g, szL=t9.b
    ],
    trans: [
      dec(res, 10, 0, 10, 1, -128, 128),
      dec(res, 10, 2, 11, 0, -128, 128),
      dec(res, 11, 1, 11, 2, -128, 128),
    ],
    rot: [
      dec(res, 12, 0, 12, 1, 0, 360),
      dec(res, 12, 2, 13, 0, 0, 360),
      dec(res, 13, 1, 13, 2, 0, 360),
    ],
    pivot: [
      dec(res, 14, 0, 14, 1, -128, 128),
      dec(res, 14, 2, 15, 0, -128, 128),
      dec(res, 15, 1, 15, 2, -128, 128),
    ],
  };
}

const EPS_SCALE = 4 / 65535 + 1e-9;
const EPS_TRANS = 256 / 65535 + 1e-9;
const EPS_ROT = 360 / 65535 + 1e-9;

describe('display-1:1 B: GUI header version + q16 round-trip', () => {
  it('t[6].b stamps GUI header version 2 (and alpha stays 255)', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg(), [OBJ], '');
    expect(pixel(res, 6, 0)[2]).toBe(2);
    expect(pixel(res, 6, 0)[3]).toBe(255);
  });

  it('scale/trans/rot/pivot round-trip within q16 epsilon', async () => {
    const api = loadWith();
    // pivot defaults to the model bbox centre: OBJ is a unit quad (x,y 0..1, z=0)
    // -> bbox centre [0.5,0.5,0]; cfg.scale=2, offset=[1,2,3] -> [2,3,3].
    const res = await api.buildOutput(baseCfg({
      scale: 2, offset: [1, 2, 3],
      displaySlots: { gui: {
        scale: [1.5, 0.25, 3.75],
        translation: [12, -6, 100],
        rotation: [45, 60, 90],
      } },
    }), [OBJ], '');
    const got = decodeGui(res);
    const wantScale = [1.5, 0.25, 3.75];
    const wantTrans = [12, -6, 100];
    const wantRot = [45, 60, 90];
    const wantPivot = [2, 3, 3]; // bbox centre [0.5,0.5,0] * scale + offset
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got.scale[i] - wantScale[i]), `scale ${i}`).toBeLessThan(EPS_SCALE);
      expect(Math.abs(got.trans[i] - wantTrans[i]), `trans ${i}`).toBeLessThan(EPS_TRANS);
      expect(Math.abs(got.rot[i] - wantRot[i]), `rot ${i}`).toBeLessThan(EPS_ROT);
      expect(Math.abs(got.pivot[i] - wantPivot[i]), `pivot ${i}`).toBeLessThan(EPS_TRANS);
    }
  });

  it('every GUI header pixel t[6],t[8..15] keeps alpha=255 (GUI premultiply safety)', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({
      displaySlots: { gui: {
        scale: [2, 2, 2], translation: [40, -40, 7], rotation: [10, 250, 359],
      } },
    }), [OBJ], '');
    // t[6] carries the version byte in .b; t[8..15] are the q16 GUI fields.
    // (t[3].a/t[4].a legitimately carry ntextures/flags, not alpha=255.)
    expect(pixel(res, 6, 0)[3], 't[6] alpha').toBe(255);
    for (let x = 8; x < 16; x++) {
      expect(pixel(res, x, 0)[3], `t[${x}] alpha`).toBe(255);
    }
  });

  it('a user pivot override still round-trips through t[14]/t[15]', async () => {
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({
      scale: 1, offset: [0, 0, 0],
      displaySlots: { gui: { pivot: [8, -8, 4] } },
    }), [OBJ], '');
    const got = decodeGui(res);
    expect(Math.abs(got.pivot[0] - 8)).toBeLessThan(EPS_TRANS);
    expect(Math.abs(got.pivot[1] - (-8))).toBeLessThan(EPS_TRANS);
    expect(Math.abs(got.pivot[2] - 4)).toBeLessThan(EPS_TRANS);
  });

  it('GUI scale 0 (blank dialog field) falls back to 1, not invisible icon', async () => {
    // A blank GUI scale field produces +'' === 0 in the old export literal.
    // The encoder must treat non-positive GUI scale as 1 so the icon stays visible.
    const api = loadWith();
    const res = await api.buildOutput(baseCfg({
      displaySlots: { gui: { scale: [0, 0, 0] } },
    }), [OBJ], '');
    const got = decodeGui(res);
    // Decoded scale should round-trip to 1 (q16 of 1 in [0,4] range), not 0.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(got.scale[i] - 1), `scale axis ${i} should be 1 not 0`).toBeLessThan(EPS_SCALE);
    }
  });
});
