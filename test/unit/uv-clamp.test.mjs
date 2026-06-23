// Task D2 / Part A: regression guard for the UV clamp in uvPixels.
//
// uvPixels encodes each UV component as u24(clamp(v,0,1) * 65535) into an RGB
// texel (the 4th channel is alpha=255). The clamp is load-bearing: the shader
// reads only the low 16 bits, so a UV outside [0,1] (tiling / negative) would
// otherwise overflow and read garbage. This is a regression GUARD (not RED->
// GREEN) — the clamp already lives in objcubed.js:uvPixels; this pins it so a
// future edit that drops the clamp is caught.
//
// Decode mirrors the shader/verifier read: value = r*65536 + g*256 + b, which
// reconstructs trunc(clamp(v)*65535).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();

// texels: array of [r,g,b,a] from uvPixels; idx selects which UV component.
function decodeU(texels, idx) {
  const [r, g, b] = texels[idx];
  return r * 65536 + g * 256 + b;
}

describe('uvPixels UV clamp (Task D2 / Part A regression guard)', () => {
  it('exposes the pure encoder', () => {
    expect(typeof api.uvPixels).toBe('function');
  });

  it('clamps out-of-range UVs to [0,1] (1.5 -> 1.0 = 65535, -0.2 -> 0)', () => {
    const a = api.uvPixels([1.5, -0.2]);
    // 1.5 clamps to 1.0 -> trunc(1.0*65535) = 65535
    expect(decodeU(a, 0)).toBe(65535);
    // -0.2 clamps to 0.0 -> 0
    expect(decodeU(a, 1)).toBe(0);
    // Every texel keeps alpha = 255.
    expect(a[0][3]).toBe(255);
    expect(a[1][3]).toBe(255);
  });

  it('passes in-range UVs through unclamped (0.5 -> ~32767, 1.0 -> 65535)', () => {
    const a = api.uvPixels([0.5, 1.0]);
    // 0.5 -> trunc(0.5*65535) = trunc(32767.5) = 32767 (a mid value, NOT clamped).
    const mid = decodeU(a, 0);
    expect(mid).toBeGreaterThanOrEqual(32767);
    expect(mid).toBeLessThanOrEqual(32768);
    // 1.0 -> 65535 (the exact upper bound is allowed through, not clamped lower).
    expect(decodeU(a, 1)).toBe(65535);
  });

  it('0 maps to 0 and the decoded value divided by 65535 round-trips the clamp', () => {
    const a = api.uvPixels([0, 0.25]);
    expect(decodeU(a, 0)).toBe(0);
    // 0.25 within epsilon after the /65535 read the shader performs.
    expect(Math.abs(decodeU(a, 1) / 65535 - 0.25)).toBeLessThan(2 / 65535);
  });
});
