// =============================================================================
// CPU-side "reference decoder" for obj³ (objcubed) armor / equipment rendering.
//
// PURPOSE: replicate the armor decode the shader does — on the CPU, with no GPU
// and no Minecraft — so the per-limb armor pipeline can be tested deterministically.
// This is the SOURCE-OF-TRUTH-FAITHFUL twin of the GLSL armor block in
//   objcubed/assets/minecraft/shaders/include/objmc_main.glsl  (search `am.a == 254`)
//   objcubed/assets/minecraft/shaders/include/objmc_tools.glsl (getmeta/getpos/getvert/getuv)
// and of the encoder side in objcubed.js (writePackedLayer, posPixels, buildVertexData).
//
// WHAT THIS COVERS (Level 1):
//   - Reading the packed armor header EXACTLY as the shader does: same texel
//     offsets, same getmeta row-0 semantics, same meta read loop, → nboxes and
//     per (box, carrier-face) the model-face index `afk`, the part, and the
//     emissive level `aemis`. This is the layer the "meta read loop too short"
//     bug lived in (t[11..13] garbage); a header round-trip test against the
//     encoder's write offsets catches that class.
//   - getmeta / getpos / getvert / getuv ports for decoding actual vertex data.
//   - Carrier-quad geometry generation from MC's jar-decoded ModelPart$Cube quads
//     (DEBUG.md), incl. mirror for left limbs and CubeDeformation inflation (grow).
//   - The world-Pos reconstruction: Gram-Schmidt basis (left/right variant), C_F
//     orientation correction, the per-face anchor (incl. perp-dim coeffs), and
//     left un-mirror. The KEY invariant exposed: a SOUTH/WEST/EAST face produces
//     the SAME world Pos as if that model face were packed on NORTH.
//
// WHAT THIS DELIBERATELY DOES *NOT* COVER:
//   - Real GPU / subgroup behaviour: `subgroupQuadBroadcast(Pos, k)` is modelled
//     here by simply passing the carrier quad's 4 corners as a0..a3 — which is
//     exactly what the broadcast yields when all 4 lanes of a quad carry the same
//     primitive. Real driver lane packing / helper invocations are not simulated.
//   - The GUI / hand / world (non-armor) render paths, animation easing, color
//     behavior, fog, lighting / `noshadow` *rendering* (we only flag emissive).
//   - MC's actual ModelView/Proj matrices, slot framing, item-frame mounting.
//   - macOS (no subgroup ext) or any platform-specific shader divergence.
//
// NOTE — POSSIBLE LEVEL 2 (do NOT build now): this machine has an AMD GPU with
// OpenGL 4.6 + GL_KHR_shader_subgroup and headless EGL, plus Java + joml + a
// Mojang-mapped MC client jar at
//   libraries/com/mojang/minecraft/26.1.2/minecraft-26.1.2-client.jar
// so a future harness could run the REAL shaders headless against a carrier mesh
// + the exported PNG and read back pixels to validate this CPU twin end-to-end.
// =============================================================================

'use strict';

const { PNG } = require('pngjs');

// ---------------------------------------------------------------------------
// tiny vec3 / mat3 helpers (column-major mat3 as [col0, col1, col2], like GLSL)
// ---------------------------------------------------------------------------
const sub   = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add   = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot   = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len   = (a) => Math.hypot(a[0], a[1], a[2]);
const norm  = (a) => scale(a, 1 / len(a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// mat3 (columns) * vec3 — GLSL `M * v`
const mulMV = (M, v) => add(add(scale(M[0], v[0]), scale(M[1], v[1])), scale(M[2], v[2]));
// mat3 * mat3 (columns) — GLSL `A * B`, result columns are A*B.col
const mulMM = (A, B) => [mulMV(A, B[0]), mulMV(A, B[1]), mulMV(A, B[2])];

// 3x3 rotation about an arbitrary axis (columns), for test bone poses.
function rotAxis(axis, ang) {
  const [x, y, z] = norm(axis);
  const c = Math.cos(ang), s = Math.sin(ang), C = 1 - c;
  // columns
  return [
    [c + x * x * C, y * x * C + z * s, z * x * C - y * s],
    [x * y * C - z * s, c + y * y * C, z * y * C + x * s],
    [x * z * C + y * s, y * z * C - x * s, c + z * z * C],
  ];
}

// ---------------------------------------------------------------------------
// Texture access: a uniform interface over either a parsed PNG or raw RGBA.
// texelFetch(x,y) returns [r,g,b,a] as 0..255 ints (matching the shader's
// `ivec4(texelFetch(...)*255.0+0.5)`).
// ---------------------------------------------------------------------------
function makeTexture(src) {
  let data, width, height;
  if (Buffer.isBuffer(src) || src instanceof Uint8Array) {
    // a PNG file buffer
    const png = PNG.sync.read(Buffer.from(src));
    data = png.data; width = png.width; height = png.height;
  } else if (src && src.data && src.width && src.height) {
    // { data, width, height } — raw RGBA
    data = src.data; width = src.width; height = src.height;
  } else {
    throw new Error('makeTexture: pass a PNG buffer or {data,width,height}');
  }
  const fetch = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  return { data, width, height, fetch };
}

// ---------------------------------------------------------------------------
// Direct ports of objmc_tools.glsl.  `topleft` is always (0,0) for armor.
// The shader fetches normalized floats (byte/255); we reproduce that exactly
// so the rounding matches the GPU bit-for-bit.
// ---------------------------------------------------------------------------
function getmeta(tex, topleft, offset) {
  // ivec4(texelFetch(...)*255+0.5): the stored bytes ARE the ivec4 (no /255 here).
  return tex.fetch(topleft[0] + offset, topleft[1]);
}

function getpos(tex, topleft, w, h, index) {
  const i = index * 3;
  const f = (k) => {
    const px = tex.fetch(topleft[0] + ((i + k) % w), topleft[1] + h + Math.floor((i + k) / w));
    return [px[0] / 255, px[1] / 255, px[2] / 255]; // normalized like the shader
  };
  const x = f(0), y = f(1), z = f(2);
  const comp = (c) => (c[0] * 256) + c[1] + (c[2] / 256);
  return [
    comp(x) * (255 / 256) - 128,
    comp(y) * (255 / 256) - 128,
    comp(z) * (255 / 256) - 128,
  ];
}

function getuv(tex, topleft, w, h, index) {
  const i = index * 2;
  const f = (k) => {
    const px = tex.fetch(topleft[0] + ((i + k) % w), topleft[1] + h + Math.floor((i + k) / w));
    return [px[0] / 255, px[1] / 255, px[2] / 255];
  };
  const x = f(0), y = f(1);
  return [
    ((x[1] * 65280) + (x[2] * 255)) / 65535,
    ((y[1] * 65280) + (y[2] * 255)) / 65535,
  ];
}

// uncompressed only (armor always passes compression=false).
function getvert(tex, topleft, w, h, index) {
  const i = index * 2;
  const a = tex.fetch(topleft[0] + ((i) % w), topleft[1] + h + Math.floor((i) / w));
  const b = tex.fetch(topleft[0] + ((i + 1) % w), topleft[1] + h + Math.floor((i + 1) / w));
  return [
    (a[0] * 65536) + (a[1] * 256) + a[2],
    (b[0] * 65536) + (b[1] * 256) + b[2],
  ];
}

// ---------------------------------------------------------------------------
// Header decode — replicates the armor block's meta read loop and per-box reads.
//   ao = (0,0).  t[i] = getmeta(ao, i) for i in [1,14).
//   nboxes = max(t[8].a, 1).  Per box abody (< nboxes):
//     NORTH face idx = t[8+abody].r:g, part = t[8+abody].b
//     SOUTH face idx = t[11+abody].r:g
//     WEST  face idx = getmeta(14+abody).r:g
//     EAST  face idx = getmeta(17+abody).r:g
//     EMISSIVE texel  = getmeta(20+abody): r=N g=S b=W a=E
//   65535 => that carrier face is culled (null here).
// Also returns size/nvertices/etc. needed to decode vertex data, mirroring the
// shader's `as`, `anv`, `ahh`, `ah`, `avph`, `avth`.
// ---------------------------------------------------------------------------
function decodeArmorHeader(src) {
  const tex = makeTexture(src);
  const ao = [0, 0];
  const am = getmeta(tex, ao, 0); // texel (0,0) — note offset 0 → the marker pixel
  const isArmor = am[0] === 12 && am[1] === 34 && am[2] === 56 && (am[3] === 254 || am[3] === 253);

  const t = [];
  t[0] = am;
  for (let i = 1; i < 14; i++) t[i] = getmeta(tex, ao, i);

  // sizes (objmc header layout) — needed to actually decode geometry.
  const as = [t[1][0] * 256 + t[1][1], t[1][2] * 256 + t[7][0]];
  const anv = t[2][0] * 16777216 + t[2][1] * 65536 + t[2][2] * 256 + t[7][1];
  const anf = Math.max(t[3][0] * 65536 + t[3][1] * 256 + t[3][2], 1);
  const ant = Math.max(t[3][3], 1);
  const avph = t[5][0] * 256 + t[5][1];
  const avth = t[5][2] * 256 + t[7][2];
  const ahh = 2 + Math.ceil((anv * 0.25) / as[0]);
  const ah = ahh + (as[1] * ant);

  const nboxes = Math.max(t[8][3], 1);
  const rd16 = (texel) => {
    const m = getmeta(tex, ao, texel);
    const v = m[0] * 256 + m[1];
    return v === 65535 ? null : v;
  };

  const boxes = [];
  for (let abody = 0; abody < nboxes; abody++) {
    const partTexel = getmeta(tex, ao, 8 + abody);
    const em = getmeta(tex, ao, 20 + abody); // r=N g=S b=W a=E
    boxes.push({
      abody,
      north: rd16(8 + abody),
      south: rd16(11 + abody),
      west:  rd16(14 + abody),
      east:  rd16(17 + abody),
      part: partTexel[2],
      emis: { n: em[0], s: em[1], w: em[2], e: em[3] },
    });
  }

  return {
    marker: am[3], isArmor, nboxes, boxes, t,
    size: as, nvertices: anv, nframes: anf, ntextures: ant,
    avph, avth, ahh, ah,
    // expose tex so callers can decode real model offsets (getpos) for a face.
    tex,
  };
}

// Decode a model face's 4 local position offsets from the texture (the same
// posoffset the shader reads via getvert→getpos, BEFORE basis/anchor). afk is
// the model-face index; frame 0 only (afr=0). aleft flips X about the centre.
// Returns 4 vec3 (corner order ac = 0..3), each already AOFF-subtracted only if
// requested (we keep it raw here; faceWorldPos handles AOFF).
function decodeModelFaceOffsets(header, afk, aleft) {
  const { tex, size, nvertices, ah, avph, avth } = header;
  const out = [];
  for (let ac = 0; ac < 4; ac++) {
    let avid = (afk * 4 + ac) % nvertices; // frame 0
    const ai = getvert(tex, [0, 0], size[0], ah + avph + avth, avid);
    let off = getpos(tex, [0, 0], size[0], ah, ai[0]);
    if (aleft) off = [-off[0], off[1], off[2]];
    out.push(off);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Carrier-quad geometry — MC's jar-decoded ModelPart$Cube quads (DEBUG.md).
// A box is W×H×D (BB units), centred at origin, scaled to blocks (1/16) and
// optionally inflated by `grow` (CubeDeformation). `mirror` (left limbs) swaps
// x0↔x1 and reverses each quad's winding.
//
// Vertex layout (8 corners), matching /tmp/verify_all.mjs `verts`:
//   0:(x0,y0,z0) 1:(x1,y0,z0) 2:(x1,y1,z0) 3:(x0,y1,z0)
//   4:(x0,y0,z1) 5:(x1,y0,z1) 6:(x1,y1,z1) 7:(x0,y1,z1)
// Jar quad index sets (DEBUG.md / verify_all POLY):
//   DOWN [5,4,0,1] UP [2,3,7,6] WEST [0,4,7,3] NORTH [1,0,3,2] EAST [5,1,2,6] SOUTH [4,5,6,7]
// ---------------------------------------------------------------------------
const POLY = {
  DOWN:  [5, 4, 0, 1],
  UP:    [2, 3, 7, 6],
  WEST:  [0, 4, 7, 3],
  NORTH: [1, 0, 3, 2],
  EAST:  [5, 1, 2, 6],
  SOUTH: [4, 5, 6, 7],
};

function boxCorners(W, H, D, grow, unit, mirror) {
  unit = unit == null ? 1 / 16 : unit;
  grow = grow || 0;
  const w = (W / 2 + grow) * unit;
  const h = (H / 2 + grow) * unit;
  const d = (D / 2 + grow) * unit;
  let x0 = -w, x1 = w;
  const y0 = -h, y1 = h, z0 = -d, z1 = d;
  if (mirror) { const tmp = x0; x0 = x1; x1 = tmp; }
  return [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
}

// Get the 4 world-space corners MC submits for one face of a box, after an
// optional pose transform (mat3 R + vec3 T applied per corner). `face` is one
// of 'NORTH'|'SOUTH'|'WEST'|'EAST'|'UP'|'DOWN'.
function carrierQuad(opts) {
  const { W, H, D, grow = 0, unit = 1 / 16, mirror = false, face,
          R = null, T = [0, 0, 0] } = opts;
  const V = boxCorners(W, H, D, grow, unit, mirror);
  let q = POLY[face].map((i) => V[i]);
  if (mirror) q = q.slice().reverse();
  return q.map((p) => add(R ? mulMV(R, p) : p, T));
}

// ---------------------------------------------------------------------------
// AOFF table (objmc_main.glsl) — per part [chest,head,r_arm,l_arm,r_leg,l_leg,r_foot,l_foot]
// ---------------------------------------------------------------------------
const AOFF = [
  [0.2925, -0.785,  -0.175 ],  // 0 chest
  [0.2925, -0.045,  -0.2925],  // 1 head
  [0.2375, -0.66,   -0.175 ],  // 2 right_arm
  [0.2375,  0.16,   -0.175 ],  // 3 left_arm
  [0.14,   -0.765,  -0.14  ],  // 4 right_leg
  [0.14,   -0.015,  -0.14  ],  // 5 left_leg
  [0.17,   -0.804,  -0.17  ],  // 6 right_foot
  [0.17,    0.004,  -0.17  ],  // 7 left_foot
];

// Perp-dim coefficients (objmc_main.glsl). Indexed by part.
//  SOUTH depth: ADWs*|a0-a1| + ADHs*|a0-a3|
//  EAST  width: ADWe*|a0-a1| + ADHe*|a0-a3|
const ADWs = [2.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
const ADHs = [-1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
const ADWe = [0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
const ADHe = [0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

// C_F orientation matrices (columns), from objmc_main.glsl mat3(...) literals.
// GLSL mat3(a,b,c, d,e,f, g,h,i) builds COLUMNS (a,b,c),(d,e,f),(g,h,i).
const CF = {
  NORTH: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  SOUTH: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
  WEST:  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  EAST:  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
};

// f6 (carrier face index) → face name. 2=W,3=N,4=E,5=S (DEBUG.md / shader gate).
const F6 = { 2: 'WEST', 3: 'NORTH', 4: 'EAST', 5: 'SOUTH' };

// Build the Gram-Schmidt basis from the carrier quad (a0..a3), left/right variant.
// Mirrors the shader exactly:
//   e1 = normalize(a0-a1); e2 = normalize(a0-a3); e2 = normalize(e2 - dot(e2,e1)*e1)
//   abasis = aleft ? mat3(-e1,-e2,-cross(e1,e2)) : mat3(-e1, e2, -cross(e1,e2))
function carrierBasis(q, aleft) {
  const a0 = q[0], a1 = q[1], a2 = q[2], a3 = q[3];
  const e1 = norm(sub(a0, a1));
  let e2 = norm(sub(a0, a3));
  e2 = norm(sub(e2, scale(e1, dot(e2, e1)))); // Gram-Schmidt
  const crs = cross(e1, e2);
  const abasis = aleft
    ? [scale(e1, -1), scale(e2, -1), scale(crs, -1)]
    : [scale(e1, -1), e2, scale(crs, -1)];
  return { a0, a1, a2, a3, e1, e2, crs, abasis };
}

// Compute the anchor for a carrier face (shader's anchor switch). `part` selects
// the perp coeffs; n = cross(e1,e2) (the shader uses `cross(e1,e2)` = our `crs`).
function faceAnchor(face, b, part) {
  const e1e = sub(b.a0, b.a1);
  const n = b.crs;
  if (face === 'NORTH') return b.a2;
  if (face === 'WEST')  return add(b.a2, e1e);
  if (face === 'SOUTH') {
    const d = ADWs[part] * len(sub(b.a0, b.a1)) + ADHs[part] * len(sub(b.a0, b.a3));
    return sub(add(b.a2, e1e), scale(n, d));
  }
  if (face === 'EAST') {
    const w = ADWe[part] * len(sub(b.a0, b.a1)) + ADHe[part] * len(sub(b.a0, b.a3));
    return sub(b.a2, scale(n, w));
  }
  throw new Error('faceAnchor: unsupported face ' + face);
}

// ---------------------------------------------------------------------------
// faceWorldPos — the headline reconstruction. Given a carrier quad (the 4 world
// corners for one box face), the carrier face f6 (2..5), whether the limb is
// left-mirrored, the part index (for AOFF + perp coeffs), and a SINGLE model-face
// local offset `modelOffset`, returns the final world Pos.
//
// Replicates exactly (objmc_main.glsl armor block, the `else` branch):
//   if (aleft) posoffset.x = -posoffset.x;       // (caller may pre-flip; see note)
//   posoffset -= AOFF[part];
//   abasisBox = abasis * CF[f6];
//   posoffset = abasisBox * posoffset;
//   anchor = <per-face>;
//   Pos = anchor + posoffset;
//
// NOTE on the left X-flip: the shader flips posoffset.x BEFORE subtracting AOFF.
// modelOffset passed here is the RAW model offset (NOT yet flipped); we apply the
// flip internally when aleft, matching the shader order.
// ---------------------------------------------------------------------------
function faceWorldPos(carrierQuad, f6, aleft, part, modelOffset) {
  const face = F6[f6];
  if (!face) throw new Error('faceWorldPos: f6 must be 2..5, got ' + f6);
  const b = carrierBasis(carrierQuad, aleft);
  let po = aleft ? [-modelOffset[0], modelOffset[1], modelOffset[2]] : modelOffset.slice();
  po = sub(po, AOFF[part]);
  const abasisBox = mulMM(b.abasis, CF[face]);
  po = mulMV(abasisBox, po);
  const anchor = faceAnchor(face, b, part);
  return add(anchor, po);
}

module.exports = {
  // vec/mat helpers (handy for tests)
  sub, add, scale, dot, len, norm, cross, mulMV, mulMM, rotAxis,
  // texture + glsl ports
  makeTexture, getmeta, getpos, getuv, getvert,
  // header + model-face decode
  decodeArmorHeader, decodeModelFaceOffsets,
  // geometry + reconstruction
  POLY, boxCorners, carrierQuad, carrierBasis, faceAnchor, faceWorldPos,
  AOFF, CF, F6, ADWs, ADHs, ADWe, ADHe,
};
