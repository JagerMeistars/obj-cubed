// Comprehensive per-slot comparison: obj3 vs a vanilla baked cube, for OFFSET, per-axis
// SIZE, and ROTATION — across every display slot. Deterministic (no GPU): the GL render-
// tester's world/hand reconstruction is subgroup-flaky (see render-tester-subgroup-limit),
// so we evaluate the SAME validated math the shader runs (bake = MC 26.1.2 item transform,
// jar-verified; world/hand = reconstruct R*S from the baked carrier edges; gui = header
// per-axis). A "vanilla cube" is bake(display, cube). obj3 = anchor + reconstruct(posoffset).
//
//   node compare.mjs   ->  per-slot table; cells = max |obj3 - vanilla| over the cube corners (blocks).

const D2R = 0.017453292;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sc = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const mulCols = (M, v) => add(add(sc(M[0], v[0]), sc(M[1], v[1])), sc(M[2], v[2])); // M = columns

function prep(raw, leftHand) {
  let [tx, ty, tz] = raw.translation ?? [0, 0, 0];
  let [rx, ry, rz] = raw.rotation ?? [0, 0, 0];
  let [sx, sy, sz] = raw.scale ?? [1, 1, 1];
  tx = clamp(tx/16, -5, 5); ty = clamp(ty/16, -5, 5); tz = clamp(tz/16, -5, 5);
  sx = clamp(sx, -4, 4); sy = clamp(sy, -4, 4); sz = clamp(sz, -4, 4);
  if (leftHand) { tx = -tx; ry = -ry; rz = -rz; }
  return { t: [tx, ty, tz], r: [rx, ry, rz], s: [sx, sy, sz] };
}
function rotXYZ(rx, ry, rz) { // columns of R = Rx*Ry*Rz
  const cx=Math.cos(rx*D2R), sx=Math.sin(rx*D2R), cy=Math.cos(ry*D2R), sy=Math.sin(ry*D2R), cz=Math.cos(rz*D2R), sz=Math.sin(rz*D2R);
  return [[cy*cz, sx*sy*cz+cx*sz, -cx*sy*cz+sx*sz], [-cy*sz, -sx*sy*sz+cx*cz, cx*sy*sz+sx*cz], [sy, -sx*cy, cx*cy]];
}
function bake(d, p) { // MC item bake: T(t)*R*S*T(-0.5)
  let v = [p[0]-0.5, p[1]-0.5, p[2]-0.5];
  v = [v[0]*d.s[0], v[1]*d.s[1], v[2]*d.s[2]];
  v = mulCols(rotXYZ(...d.r), v);
  return add(v, d.t);
}

// FIXED carrier (v0.5.45): from[8,8,8] to[24,24,8] -> block from(.5,.5,.5) to(1.5,1.5,.5).
// FaceBakery NORTH: c0=(maxX,maxY,minZ) c1=(maxX,minY,minZ) c2=(minX,minY,minZ)=anchor c3=(minX,maxY,minZ)
const PH = { c0:[1.5,1.5,0.5], c1:[1.5,0.5,0.5], c2:[0.5,0.5,0.5], c3:[0.5,1.5,0.5] };
const CUBE_CENTRE = [0.5, 0.5, 0.5];
const CORNERS = []; for (const x of [-0.5,0.5]) for (const y of [-0.5,0.5]) for (const z of [-0.5,0.5]) CORNERS.push([x,y,z]);

// vanilla cube corner: bake(display, cube_centre + p)  (p is the centred-model offset, +-0.5)
const vanilla = (d, p) => bake(d, add(CUBE_CENTRE, p));

// obj3 world/hand: Pos = baked_c2 + reconstruct(p) from the baked carrier edges
function objHandWorld(d, p) {
  const c0 = bake(d, PH.c0), c1 = bake(d, PH.c1), c2 = bake(d, PH.c2), c3 = bake(d, PH.c3);
  const ex = sub(c0, c1), ey = sub(c0, c3);     // +Y edge (len Sy), +X edge (len Sx)
  const sxv = len(ex), syv = len(ey);
  const u1 = norm(ex), u2 = norm(sub(ey, sc(u1, dot(ey, u1))));
  const fullRot = [u2, u1, cross(u2, u1)];
  const scaleVec = [syv, sxv, Math.min(sxv, syv)]; // X,Y from edges; Z=min (perpendicular, unmeasurable)
  return add(c2, mulCols(fullRot, [p[0]*scaleVec[0], p[1]*scaleVec[1], p[2]*scaleVec[2]]));
}
// obj3 gui: header carries per-axis scale + rotation directly -> exact; anchor still baked_c2
function objGui(d, p) {
  return add(bake(d, PH.c2), mulCols(rotXYZ(...d.r), [p[0]*d.s[0], p[1]*d.s[1], p[2]*d.s[2]]));
}

const SLOTS = [
  { name: 'thirdperson_righthand', fn: objHandWorld, left: false },
  { name: 'thirdperson_lefthand',  fn: objHandWorld, left: true  },
  { name: 'firstperson_righthand', fn: objHandWorld, left: false },
  { name: 'firstperson_lefthand',  fn: objHandWorld, left: true  },
  { name: 'head',                  fn: objHandWorld, left: false },
  { name: 'ground',                fn: objHandWorld, left: false },
  { name: 'fixed (frame)',         fn: objHandWorld, left: false },
  { name: 'on_shelf',              fn: objHandWorld, left: false },
  { name: 'gui',                   fn: objGui,       left: false },
];
const TESTS = [
  { key: 'offset',   raw: { translation: [0, 3, 0] } },     // pure placement (hand baseline)
  { key: 'uniform2', raw: { scale: [2, 2, 2] } },
  { key: 'sizeX',    raw: { scale: [2, 1, 1] } },
  { key: 'sizeY',    raw: { scale: [1, 2, 1] } },
  { key: 'sizeZ',    raw: { scale: [1, 1, 2] } },
  { key: 'rot',      raw: { rotation: [45, 30, 0] } },
  { key: 'rot+sz',   raw: { rotation: [20, 40, 10], scale: [1.5, 1.5, 1.5] } },
];

function maxDiv(slot, test) {
  const d = prep(test.raw, slot.left);
  let m = 0;
  for (const p of CORNERS) m = Math.max(m, len(sub(vanilla(d, p), slot.fn(d, p))));
  return m;
}
const cell = v => (v < 1e-9 ? 'OK' : v.toFixed(3));

console.log('obj3 vs vanilla baked cube — max corner divergence (blocks). OK = exact match.\n');
const head = 'slot'.padEnd(23) + TESTS.map(t => t.key.padEnd(10)).join('');
console.log(head); console.log('-'.repeat(head.length));
let worstZ = 0;
for (const s of SLOTS) {
  let row = s.name.padEnd(23);
  for (const t of TESTS) { const v = maxDiv(s, t); row += cell(v).padEnd(10); if (t.key === 'sizeZ' && s.fn === objHandWorld) worstZ = Math.max(worstZ, v); }
  console.log(row);
}
console.log('\nOffset/uniform/sizeX/sizeY/rotation/rot+sz must be OK on every slot (centring + scale + rotation correct).');
console.log(`sizeZ diverges on world/hand slots (flat carrier exposes only 2 edges -> depth uses min(Sx,Sy)); max ${worstZ.toFixed(3)} block. GUI is exact on all (header carries per-axis).`);
