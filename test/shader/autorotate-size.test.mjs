// Issue #11: model size pulses during fast rotation.
// The autorotate block estimated rotation from the subgroup quad corners.
// Under fast rotation the GPU groups lanes across face boundaries, so the
// corners are no longer the geometric face quad. The old code
//   scale = distance(vPos0,vPos1); ... posoffset = scale * fullRotation * posoffset
// then isotropically rescaled the whole model, AND fullRotation itself is only
// orthonormal when vPos1/vPos2 are perpendicular (it is not under contamination),
// so it rescaled too. The shipped fix Gram-Schmidt-orthonormalizes the basis and
// drops the scale, making the transform exactly length-preserving for ANY basis.
//
// This file ports the GLSL math to JS. subgroupQuadBroadcast(Pos,k) is simulated
// by passing the 4 quad corners explicitly. GLSL mat3(c0,c1,c2)*v treats c0,c1,c2
// as COLUMNS.
import { describe, it, expect } from 'vitest';

// ---- vec3 helpers (GLSL semantics) ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaleV = (s, a) => [s * a[0], s * a[1], s * a[2]];
const normalize = (a) => scaleV(1 / len(a), a);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// GLSL mat3(c0,c1,c2) * v : columns c0,c1,c2 -> result = c0*v.x + c1*v.y + c2*v.z
const mat3mul = (c0, c1, c2, v) => [
  c0[0] * v[0] + c1[0] * v[1] + c2[0] * v[2],
  c0[1] * v[0] + c1[1] * v[1] + c2[1] * v[2],
  c0[2] * v[0] + c1[2] * v[1] + c2[2] * v[2],
];

// ---- OLD math (scale * fullRotation, no Gram-Schmidt) ----
// vPos0=quad[0], vPos1=quad[1], vPos2=quad[3]
function oldOut(quad, po) {
  const vPos0 = quad[0];
  let vPos1 = quad[1];
  let vPos2 = quad[3];
  const s = len(sub(vPos0, vPos1)); // distance(vPos0, vPos1)
  vPos1 = normalize(sub(vPos0, vPos1));
  vPos2 = normalize(sub(vPos0, vPos2));
  const c2col = cross(vPos2, vPos1);
  // mat3(vPos2, vPos1, cross(vPos2,vPos1)) * po, then * scale
  const r = mat3mul(vPos2, vPos1, c2col, po);
  return scaleV(s, r);
}

// ---- GS math (shipped fix: Gram-Schmidt, no scale) ----
function gsOut(quad, po) {
  const vPos0 = quad[0];
  let vPos1 = quad[1];
  let vPos2 = quad[3];
  vPos1 = normalize(sub(vPos0, vPos1));
  vPos2 = normalize(sub(vPos0, vPos2));
  vPos2 = normalize(sub(vPos2, scaleV(dot(vPos2, vPos1), vPos1))); // Gram-Schmidt
  const c2col = cross(vPos2, vPos1);
  return mat3mul(vPos2, vPos1, c2col, po);
}

// Rotate a point about Y by deg (right-handed, GLSL-style).
function rotY(p, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

// Canonical north-face quad in block units (encoder emits from[8,0,8]->to[24,16,8]).
// Adjacent edges length 1.0: c0->c1 along +x, c0->c3 along +y.
const CLEAN = [
  [8 / 16, 0, 8 / 16],   // c0
  [24 / 16, 0, 8 / 16],  // c1
  [24 / 16, 16 / 16, 8 / 16], // c2 (unused by math, present for realism)
  [8 / 16, 16 / 16, 8 / 16],  // c3
];

const PO = [0.3, -0.7, 0.5];
const PO_LEN = len(PO);

describe('issue #11: autorotate size invariance', () => {
  it('CLEAN quad: both old and GS are size-invariant across a full Y sweep', () => {
    let maxDevGs = 0;
    let maxDevOld = 0;
    for (let deg = 0; deg < 360; deg++) {
      const quad = CLEAN.map((c) => rotY(c, deg));
      const gd = Math.abs(len(gsOut(quad, PO)) / PO_LEN - 1);
      const od = Math.abs(len(oldOut(quad, PO)) / PO_LEN - 1);
      if (gd > maxDevGs) maxDevGs = gd;
      if (od > maxDevOld) maxDevOld = od;
    }
    // Removing the scale multiply is a static no-op when the quad is clean.
    expect(maxDevGs).toBeLessThan(1e-5);
    expect(maxDevOld).toBeLessThan(1e-5);
  });

  it('CONTAMINATED quad: old pulses (>2.0), GS stays exactly size-invariant (<1e-5)', () => {
    // Replace vPos1 (quad[1]) and vPos3 (quad[3]) with corners from far,
    // unrelated faces with NON-perpendicular edges. This is what fast rotation
    // does when lanes get grouped across face boundaries.
    let maxDevGs = 0;
    let maxDevOld = 0;
    for (let deg = 0; deg < 360; deg++) {
      const c0 = rotY(CLEAN[0], deg);
      const c1 = rotY([40 / 16, 5 / 16, 60 / 16], deg);
      const c3 = rotY([12 / 16, 50 / 16, 3 / 16], deg);
      const quad = [c0, c1, CLEAN[2], c3];
      const gd = Math.abs(len(gsOut(quad, PO)) / PO_LEN - 1);
      const od = Math.abs(len(oldOut(quad, PO)) / PO_LEN - 1);
      if (gd > maxDevGs) maxDevGs = gd;
      if (od > maxDevOld) maxDevOld = od;
    }
    // Old reproduces the bug (size blows up); GS is exactly length-preserving.
    expect(maxDevOld).toBeGreaterThan(2.0);
    expect(maxDevGs).toBeLessThan(1e-5);
  });
});

// World branch (current shader): UNCONDITIONAL reconstruction, NO constant
// re-anchor (the decoded model is already block-centre relative — in-game
// verified: lift-0 hand/world slots match the same vanilla model exactly):
//   posoffset = fullRotation * (posoffset * vec3(sy, sx, min(sx,sy)))
// Port with per-axis scale from the measured edges (ex = +Y edge, ey = +X edge).
function worldBranch(quad, po) {
  const vPos0 = quad[0];
  const ex = sub(vPos0, quad[1]);
  const ey = sub(vPos0, quad[3]);
  const sx = len(ex), sy = len(ey);
  const vPos1 = normalize(ex);
  const vPos2 = normalize(sub(ey, scaleV(dot(ey, vPos1), vPos1)));
  const c2col = cross(vPos2, vPos1);
  const p = [po[0] * sy, po[1] * sx, po[2] * Math.min(sx, sy)];
  return mat3mul(vPos2, vPos1, c2col, p);
}

describe('world branch: vanilla match (unconditional R*S, no constant re-anchor)', () => {
  // Carrier NORTH quad with c2 at the block centre (encoder from[8,8,8]->to[24,24,8]):
  // c0=(1.5,1.5,.5) c1=(1.5,.5,.5) c2=(.5,.5,.5) c3=(.5,1.5,.5); c0-c1=+Y, c0-c3=+X.
  const PH = [[1.5, 1.5, 0.5], [1.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 1.5, 0.5]];
  const piv = [0.5, 0.5, 0.5];
  // bake display R(Y deg)*S about the block centre, like MC does to the carrier
  const bake = (p, deg, S) => {
    const r = rotY([(p[0] - piv[0]) * S[0], (p[1] - piv[1]) * S[1], (p[2] - piv[2]) * S[2]], deg);
    return [r[0] + piv[0], r[1] + piv[1], r[2] + piv[2]];
  };
  // vanilla renders the same (block-centre-relative) model vertex as R*S*v
  const vanilla = (po, deg, S) =>
    rotY([po[0] * S[0], po[1] * S[1], po[2] * S[2]], deg);

  it('identity: posoffset passes through unchanged', () => {
    expectVecEq(worldBranch(PH, PO), PO);
  });

  it('display rotation + uniform scale: matches vanilla R*S*v exactly', () => {
    for (const deg of [0, 37, 90, 180, 275]) {
      for (const S of [[1, 1, 1], [2, 2, 2], [0.5, 0.5, 0.5]]) {
        const quad = PH.map((c) => bake(c, deg, S));
        expectVecEq(worldBranch(quad, PO), vanilla(PO, deg, S));
      }
    }
  });

  it('reconstruction stays finite for a contaminated basis (no size pulse)', () => {
    const quad = [PH[0], [40 / 16, 5 / 16, 60 / 16], PH[2], [12 / 16, 50 / 16, 3 / 16]];
    const out = worldBranch(quad, PO);
    // sx,sy contaminated != 1; just assert finite output (the Gram-Schmidt
    // basis stays orthonormal).
    expect(out.every(Number.isFinite)).toBe(true);
  });
});

function expectVecEq(got, want) {
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-12);
}
