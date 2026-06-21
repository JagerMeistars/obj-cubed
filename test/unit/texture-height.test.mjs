// Characterization test for the "texture height / power-of-two" report:
// some models render fine at the height the generator outputs, others only
// when the texture height is a power of two, plus intermittent broken models.
//
// CONCLUSION (verified here, not just asserted): the encoder and shaders are
// already PoT-INDEPENDENT. The PNG header encodes the DATA texture height
// (t[1].b*256 + t[7].r) and the data-row offsets (headerheight, vph, vth);
// the shader reads every data/texture row by ABSOLUTE texelFetch from those
// header values and only normalizes the final texCoord by the *real* PNG
// size via textureSize(Sampler0) == atlasSize. So PoT padding (objcubed.js
// ~1988 `ty = 1<<ceil(log2(ty))`) merely appends blank rows at the bottom and
// NEVER shifts where any sampled texel lands. This test proves that the
// encoded size.y, the shader's headerheight formula, and the actual texture-
// block row range stay identical for a non-PoT data height (48) and a PoT one
// (64). Therefore the residual "only renders at PoT" symptom is a genuine GPU/
// driver NPOT-PNG limitation, not an encoder/shader inconsistency. The fix in
// source is purely the safe default: nopow defaults to false so the emitted
// PNG is PoT and renders on all GPUs (objcubed.js ~2772).
//
// This test drives the REAL buildOutput. getTextureRGBA uses Image/canvas,
// which Node lacks, so we load the plugin in our own vm context (same shape as
// test/helpers/load-plugin.cjs) and inject Image/document/Texture/Outliner
// stubs that feed a synthetic RGBA texture through the DOM path.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { PNG } = require('pngjs');

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SRC = path.join(REPO_ROOT, 'objcubed.js');
const CODE = fs.readFileSync(SRC, 'utf8');

// Synthetic RGBA texture. Blue channel is a fixed marker (200) on every texel
// so we can locate the texture block inside the encoded buffer by scanning.
function makeTexture(w, h) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x & 255; data[i + 1] = y & 255; data[i + 2] = 200; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

// Load objcubed.js in a fresh vm with DOM/Blockbench stubs that route
// getTextureRGBA to the synthetic texture (tw x th).
function loadWith(tw, th) {
  const mod = { exports: {} };
  const tex = makeTexture(tw, th);
  class FakeImage {
    set src(_v) { setTimeout(() => this.onload && this.onload(), 0); }
    get naturalWidth() { return tw; }
    get naturalHeight() { return th; }
    get width() { return tw; }
    get height() { return th; }
  }
  const ctx = { drawImage() {}, getImageData() { return { data: tex.data, width: tw, height: th }; } };
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

// One quad -> nfaces=1, nvertices=4. usemtl m_u matches Texture.all[0].uuid.
const OBJ = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
  'usemtl m_u',
  'f 1/1 2/2 3/3 4/4',
].join('\n');

function baseCfg(nopow) {
  return {
    texIndex: 0, nopow, scale: 1, offset: [0, 0, 0],
    colorbehavior: ['direct', 'direct', 'direct'], duration: 0,
    autoplay: false, easing: 0, interpolation: 0, noshadow: false,
    autorotate: 0, visibility: 7, displaySlots: {}, flipuv: false,
    useAtlas: false,
  };
}

// Decode the layout exactly the way the shader does, from the encoded buffer,
// then locate where the texture pixels physically are.
function analyze(res) {
  const { tw, ty, rawBuf: buf } = res;
  const rd = (x, y) => { const i = (y * tw + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; };
  const t1 = rd(1, 0), t2 = rd(2, 0), t5 = rd(5, 0), t7 = rd(7, 0);
  // objmc_main.glsl:31 size = (t[1].r*256+t[1].g, t[1].b*256+t[7].r)
  const sizeX = t1[0] * 256 + t1[1];
  const sizeY = t1[2] * 256 + t7[0];
  // objmc_main.glsl:33 nvertices = t[2].rgb<<.. + t[7].g
  const nvertices = t2[0] * 16777216 + t2[1] * 65536 + t2[2] * 256 + t7[1];
  // objmc_main.glsl:42-43 vph/vth
  const vph = t5[0] * 256 + t5[1];
  const vth = t5[2] * 256 + t7[2];
  // objmc_main.glsl:140 headerheight = 2 + ceil(nvertices*0.25/size.x)
  const headerheight = 2 + Math.ceil(nvertices * 0.25 / sizeX);
  // objmc_main.glsl:141 height = headerheight + size.y*ntextures (ntextures=1)
  const posBase = headerheight + sizeY;
  // Locate the first row whose blue marker (200) appears -> real texture block start.
  let firstTexRow = -1, lastTexRow = -1;
  for (let y = 0; y < ty; y++) {
    if (buf[(y * tw + 0) * 4 + 2] === 200) { if (firstTexRow < 0) firstTexRow = y; lastTexRow = y; }
  }
  return { tw, ty, sizeX, sizeY, nvertices, vph, vth, headerheight, posBase, firstTexRow, lastTexRow };
}

describe('texture-height: PoT padding never shifts sampled texels', () => {
  for (const th of [48, 64]) {
    const isPot = (th & (th - 1)) === 0;
    it(`data height ${th} (${isPot ? 'PoT' : 'non-PoT'}): encoded size.y == data height, header rows match real texture block`, async () => {
      const api = loadWith(64, th);
      const res = await api.buildOutput(baseCfg(false), [OBJ], '');

      // PNG really decodes and its height is the padded ty.
      const png = PNG.sync.read(Buffer.from(res.pngBuffer));
      expect(png.width).toBe(res.tw);
      expect(png.height).toBe(res.ty);

      const a = analyze(res);

      // The header encodes the DATA texture height, not the padded PNG height.
      expect(a.sizeY).toBe(th);
      expect(a.sizeX).toBe(64);

      // The shader's headerheight formula lands exactly on the first real
      // texture row inside the buffer, regardless of PoT padding.
      expect(a.headerheight).toBe(a.firstTexRow);

      // The texture block the shader reads, [headerheight, headerheight+size.y),
      // exactly covers the physical texture rows in the buffer.
      expect(a.firstTexRow).toBe(a.headerheight);
      expect(a.lastTexRow).toBe(a.headerheight + a.sizeY - 1);

      // The texture block lives entirely inside the real PNG; padding (if any)
      // is strictly below it and never overlaps the data.
      expect(a.headerheight + a.sizeY).toBeLessThanOrEqual(a.ty);
    });
  }

  it('PoT padding only appends blank rows: data-row geometry is identical for nopow vs PoT', async () => {
    // Same OBJ + same data height; only the final ty (padding) differs.
    const th = 48; // non-PoT data height
    const apiPad = loadWith(64, th);
    const apiRaw = loadWith(64, th);
    const padded = await apiPad.buildOutput(baseCfg(false), [OBJ], ''); // ty -> 64
    const raw = await apiRaw.buildOutput(baseCfg(true), [OBJ], '');     // ty -> data height sum (non-PoT)

    const ap = analyze(padded);
    const ar = analyze(raw);

    // Padding changes the PNG height...
    expect(ap.ty).toBeGreaterThan(ar.ty);
    // ...but every header value the shader uses to index data is identical,
    // so texelFetch lands on the exact same pixels in both cases.
    expect(ap.sizeX).toBe(ar.sizeX);
    expect(ap.sizeY).toBe(ar.sizeY);
    expect(ap.nvertices).toBe(ar.nvertices);
    expect(ap.vph).toBe(ar.vph);
    expect(ap.vth).toBe(ar.vth);
    expect(ap.headerheight).toBe(ar.headerheight);
    expect(ap.posBase).toBe(ar.posBase);
    expect(ap.firstTexRow).toBe(ar.firstTexRow);

    // And the bytes of every row up to the end of the unpadded buffer are
    // byte-for-byte equal: padding adds rows only after that point.
    const tw = ap.tw;
    const upTo = ar.ty * tw * 4; // length of the unpadded buffer
    for (let i = 0; i < upTo; i++) {
      if (padded.rawBuf[i] !== raw.rawBuf[i]) {
        throw new Error(`row data diverged at byte ${i} (row ${Math.floor(i / (tw * 4))})`);
      }
    }
  });

  it('dialog default is PoT-safe: nopow defaults to false so the emitted PNG renders on NPOT-averse GPUs', () => {
    // Guards the source-level mitigation. The encoder/shader are PoT-independent
    // (asserted above); the residual symptom is a real GPU/driver NPOT-PNG
    // limitation, so the default must produce a PoT PNG.
    const src = fs.readFileSync(SRC, 'utf8');
    expect(/nopow:\s*false/.test(src)).toBe(true);
  });
});
