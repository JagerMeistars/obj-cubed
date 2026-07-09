// Frame-count off-by-one: BB stores animation length rounded to ~5 decimals,
// so span*fps for non-decimal fps lands just below the integer and floor()
// dropped the FINAL keyframe (play_once froze one frame short of the end pose).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const { frameCountOf } = loadObjcubed();

describe('frameCountOf: endpoint-inclusive sampled frame count', () => {
  it('24fps + BB-rounded 1/3s length keeps the final keyframe (the pistol bug)', () => {
    // true length 8/24 = 0.333333…, BB stores 0.33333 -> span 7.99992
    expect(frameCountOf(0, 0.33333, 24)).toBe(9);
  });
  it('exact spans stay exact', () => {
    expect(frameCountOf(0, 0.5, 20)).toBe(11);   // walk: 10 intervals + 1
    expect(frameCountOf(0, 1, 20)).toBe(21);
    expect(frameCountOf(0.25, 0.5, 20)).toBe(6); // frameStart offset
  });
  it('user-typed decimals that float just below the integer still snap (1.16*25)', () => {
    expect(frameCountOf(0, 1.16, 25)).toBe(30);  // 28.999… -> 29 + 1
  });
  it('a deliberate mid-frame trim still floors', () => {
    expect(frameCountOf(0, 0.52, 20)).toBe(11);  // 10.4 -> 10 + 1
  });
  it('degenerate/zero spans clamp to 1 frame', () => {
    expect(frameCountOf(0, 0, 20)).toBe(1);
    expect(frameCountOf(0.5, 0.2, 20)).toBe(1);
  });
});
