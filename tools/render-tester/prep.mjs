// Render-tester prep: turn a REAL obj3 export into render.c inputs, baking the slot's
// display transform into the carrier verts EXACTLY as MC 26.1.2 does (verified against
// the Mojang-mapped jar — see the verify-item-display-bake workflow spec), and emit a
// vanilla 16^3 reference cube baked with the SAME display. Under the same camera, the
// obj3 decoded cube and the reference cube coincide wherever the shader reconstruction
// is correct (identity/uniform/X/Y/rotation); pure per-axis Z diverges (flat carrier).
//
//   node prep.mjs <export.png> <slot.json> <outdir> [sx,sy,sz]
//     [sx,sy,sz] optional scale OVERRIDE (test per-axis without re-exporting).
//   outputs: tex.raw, verts.f32 (baked carrier), uv.f32, ref.f32 (baked ref cube), meta.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { PNG } from 'pngjs';

const [, , pngPath, jsonPath, outDir, scaleArg] = process.argv;
if (!outDir) { console.error('usage: node prep.mjs <png> <slot.json> <outdir> [sx,sy,sz]'); process.exit(1); }

// --- texture ---
const png = PNG.sync.read(readFileSync(pngPath));
writeFileSync(`${outDir}/tex.raw`, Buffer.from(png.data));

// --- slot + display block ---
const slot = basename(jsonPath).replace(/^tester_/, '').replace(/\.json$/, '');
const leftHand = /lefthand/i.test(slot);
const model = JSON.parse(readFileSync(jsonPath, 'utf8'));
let raw = { ...(model.display?.[slot] ?? {}) };
if (scaleArg) raw.scale = scaleArg.split(',').map(Number);   // per-axis override

// --- MC 26.1.2 item display bake (spec §1): M = T(t)·R(xyz)·S·T(-0.5), world = M*p ---
const D2R = 0.017453292;
function prepDisplay(raw, leftHand) {
  let [tx, ty, tz] = raw.translation ?? [0, 0, 0];
  let [rx, ry, rz] = raw.rotation ?? [0, 0, 0];
  let [sx, sy, sz] = raw.scale ?? [1, 1, 1];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  tx = clamp(tx / 16, -5, 5); ty = clamp(ty / 16, -5, 5); tz = clamp(tz / 16, -5, 5); // /16 THEN clamp
  sx = clamp(sx, -4, 4); sy = clamp(sy, -4, 4); sz = clamp(sz, -4, 4);
  if (leftHand) { tx = -tx; ry = -ry; rz = -rz; }            // ONLY tx, ry, rz
  return { t: [tx, ty, tz], r: [rx, ry, rz], s: [sx, sy, sz] };
}
function rotXYZ(rx, ry, rz) { // intrinsic XYZ, R = Rx·Ry·Rz (== diff.mjs / Quaternionf.rotationXYZ)
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R);
  const cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
  const cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy],
  ];
}
const mvec = (R, v) => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];
function bake(d, p) {                            // p in block units (json/16)
  let v = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];  // recenter about block centre (NO +0.5 after)
  v = [v[0] * d.s[0], v[1] * d.s[1], v[2] * d.s[2]];
  v = mvec(rotXYZ(d.r[0], d.r[1], d.r[2]), v);
  return [v[0] + d.t[0], v[1] + d.t[1], v[2] + d.t[2]];
}
const d = prepDisplay(raw, leftHand);

// --- carrier verts (BAKED) + UV0 (rect centre -> the marker-offset data pixel) ---
// CARRIER_FIX_DY: the -0.5 block (8px) Y centering fix lives in the plugin now
// (placeholder from[8,8,8] to[24,24,8] — anchor c2 at cube CENTRE). Re-exported models
// carry it already, so default 0 (read JSON as-is). To test the fix on an OLD export not
// yet re-exported, run with CARRIER_FIX_DY=8 to simulate the shifted carrier.
const CARRIER_FIX_DY = Number(process.env.CARRIER_FIX_DY ?? 0);
const els = model.elements ?? [];
const verts = [], uvs = [];
for (const e of els) {
  const [x0, y0, z0] = e.from, [x1, y1, z1] = e.to;
  const pf = (X, Y, Z) => { const b = bake(d, [X / 16, (Y + CARRIER_FIX_DY) / 16, Z / 16]); verts.push(b[0], b[1], b[2]); };
  pf(x1, y1, z0); pf(x1, y0, z0); pf(x0, y0, z0); pf(x0, y1, z0);   // FaceBakery NORTH order
  const u = e.faces.north.uv;
  const cu = (u[0] + u[2]) / 2 / 16, cv = (u[1] + u[3]) / 2 / 16;
  for (let k = 0; k < 4; k++) uvs.push(cu, cv);
}
writeFileSync(`${outDir}/verts.f32`, Buffer.from(new Float32Array(verts).buffer));
writeFileSync(`${outDir}/uv.f32`, Buffer.from(new Float32Array(uvs).buffer));

// --- vanilla 16^3 reference cube (spec §7), BAKED with the same display ---
const lo = 0, hi = 1;
const FACES = [ // TR, BR, BL, TL per face (winding irrelevant — no culling)
  [[hi, hi, lo], [hi, lo, lo], [lo, lo, lo], [lo, hi, lo]], // NORTH -Z
  [[lo, hi, hi], [lo, lo, hi], [hi, lo, hi], [hi, hi, hi]], // SOUTH +Z
  [[lo, hi, lo], [lo, lo, lo], [lo, lo, hi], [lo, hi, hi]], // WEST  -X
  [[hi, hi, hi], [hi, lo, hi], [hi, lo, lo], [hi, hi, lo]], // EAST  +X
  [[hi, hi, lo], [hi, hi, hi], [lo, hi, hi], [lo, hi, lo]], // UP    +Y
  [[hi, lo, hi], [hi, lo, lo], [lo, lo, lo], [lo, lo, hi]], // DOWN  -Y
];
const ref = [];
for (const f of FACES) for (const c of f) { const b = bake(d, c); ref.push(b[0], b[1], b[2]); }
writeFileSync(`${outDir}/ref.f32`, Buffer.from(new Float32Array(ref).buffer));

const nverts = verts.length / 3;
writeFileSync(`${outDir}/meta.txt`, `${png.width} ${png.height} ${nverts}\n`);
console.log(`slot=${slot} leftHand=${leftHand}`);
console.log(`display: scale=[${d.s}] rot=[${d.r}] t(/16,clamped)=[${d.t.map(n => n.toFixed(4))}]`);
console.log(`tex ${png.width}x${png.height} | carrier ${nverts} verts (baked) | ref cube 24 verts (baked)`);
