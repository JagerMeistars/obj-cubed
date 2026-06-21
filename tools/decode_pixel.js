#!/usr/bin/env node
// Decode a debug-mode pixel back into its shader value.
//
// Usage:
//   node decode_pixel.js <r> <g> <b> <range>
//   node decode_pixel.js 128 64 200 16
//   → "x=0.06 y=-7.97 z=9.10" for range=16
//
// `range` is the RANGE_HINT from the debug block in objmc_main.glsl
// (A1: 32, A2: 16, A3: 32).

const [r, g, b, range] = process.argv.slice(2).map(Number);

if ([r, g, b, range].some(v => Number.isNaN(v))) {
  console.error('Usage: node decode_pixel.js <r 0-255> <g 0-255> <b 0-255> <range>');
  console.error('  range = 32 for Pos/anchor (A1, A3), 16 for posoffset (A2)');
  process.exit(1);
}

const decode = byte => (byte / 255) * 2 * range - range;

console.log(`x=${decode(r).toFixed(2)} y=${decode(g).toFixed(2)} z=${decode(b).toFixed(2)}`);
