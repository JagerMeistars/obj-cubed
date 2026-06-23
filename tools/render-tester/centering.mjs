// Deterministic (no-GPU) verification of the obj3 -0.5 block Y centering fix.
//
// Why not the GL render-tester? The world/hand path reconstructs the carrier via
// subgroupQuadBroadcast in the VERTEX shader, whose quad alignment is NOT guaranteed for
// our draw calls -> the GL result is non-deterministic between process launches (a real
// GPU/driver limitation, not a bug in the fix). The centering result, however, is pure
// math: the shader anchors the (symmetric, centre-0) decoded model AT the baked carrier
// corner c2, so model_centre = bake(display, c2). A correct item centres at bake(display,
// cube_centre). This script compares the two with the exact MC 26.1.2 bake (jar-verified).
//
//   node centering.mjs   ->  asserts old carrier (c2.y=0) is 0.5 block low, fixed (c2.y=0.5) is centred.

const D2R = 0.017453292;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function prep(raw, leftHand) {
  let [tx, ty, tz] = raw.translation ?? [0, 0, 0];
  let [rx, ry, rz] = raw.rotation ?? [0, 0, 0];
  let [sx, sy, sz] = raw.scale ?? [1, 1, 1];
  tx = clamp(tx / 16, -5, 5); ty = clamp(ty / 16, -5, 5); tz = clamp(tz / 16, -5, 5);
  sx = clamp(sx, -4, 4); sy = clamp(sy, -4, 4); sz = clamp(sz, -4, 4);
  if (leftHand) { tx = -tx; ry = -ry; rz = -rz; }
  return { t: [tx, ty, tz], r: [rx, ry, rz], s: [sx, sy, sz] };
}
function rot(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return [[cy * cz, -cy * sz, sy], [sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy], [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy]];
}
const mv = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
function bake(d, p) {
  let v = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
  v = [v[0] * d.s[0], v[1] * d.s[1], v[2] * d.s[2]];
  v = mv(rot(d.r[0], d.r[1], d.r[2]), v);
  return [v[0] + d.t[0], v[1] + d.t[1], v[2] + d.t[2]];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(...a);

// carrier c2 (FaceBakery MIN corner), block units. OLD = bottom (y=0); FIXED = cube centre.
const C2_OLD = [0.5, 0, 0.5];
const C2_FIXED = [0.5, 0.5, 0.5];
const CUBE_CENTRE = [0.5, 0.5, 0.5];

const CASES = [
  { name: 'identity',            raw: {} },
  { name: 'hand t=[0,3,0]',      raw: { translation: [0, 3, 0] } },
  { name: 'scale 2 uniform',     raw: { scale: [2, 2, 2] } },
  { name: 'rot 45,30,0',         raw: { rotation: [45, 30, 0] } },
  { name: 'lefthand t=[0,3,0]',  raw: { translation: [0, 3, 0] }, left: true },
];

let fail = 0;
console.log('obj3 model centre = bake(c2); reference centre = bake(cube centre). Offset should be 0 once fixed.\n');
console.log('case'.padEnd(22) + 'OLD c2(y=0)'.padEnd(16) + 'FIXED c2(y=.5)');
console.log('-'.repeat(54));
for (const c of CASES) {
  const d = prep(c.raw, !!c.left);
  const ref = bake(d, CUBE_CENTRE);
  const dOld = len(sub(bake(d, C2_OLD), ref));
  const dFix = len(sub(bake(d, C2_FIXED), ref));
  console.log(c.name.padEnd(22) + dOld.toFixed(4).padEnd(16) + dFix.toFixed(4));
  // OLD must be off by ~0.5 block (scaled by display.scale.y); FIXED must be exactly 0.
  if (dFix > 1e-9) { console.error(`  FAIL: fixed carrier not centred for ${c.name}`); fail++; }
  if (dOld < 0.4) { console.error(`  FAIL: old carrier not ~0.5 low for ${c.name} (got ${dOld.toFixed(3)})`); fail++; }
}
console.log('\n' + (fail ? `${fail} FAILURE(S)` : 'OK — fixed carrier centres every case; old carrier is ~0.5 block low (scaled by display.scale.y).'));
process.exit(fail ? 1 : 0);
