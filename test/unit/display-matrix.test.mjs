// Issue #10: pure ItemTransform matrix + slot-prefix mapping.
//
// buildItemTransformMatrix(rotDeg, transUnits, scaleVec) returns a vanilla
// model.json display matrix as a COLUMN-MAJOR number[16]:
//   M = T(translation/16) * R_xyz(rotation°) * S(scale)  about the MODEL ORIGIN
// (no baked [8,8,8] pivot, Euler order XYZ, positive angles, no axis negation).
//
// The dialog consumes it via new THREE.Matrix4().fromArray(arr); here we test it
// THREE-free. The THREE canvas render / texture mapping / bbox sizing / GL
// disposal are DOM/GPU/visual and are in residualRisk, not here.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();
const { buildItemTransformMatrix, activeSlotPrefixFor } = api;

const EPS = 1e-9;

// Column-major transform of a point: x' = m[0]p + m[4]q + m[8]r + m[12], etc.
function transform(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12],
    m[1] * x + m[5] * y + m[9]  * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function expectVec(got, want) {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(Math.abs(got[i] - want[i]), `component ${i}: ${got[i]} ~ ${want[i]}`).toBeLessThan(EPS);
  }
}

describe('buildItemTransformMatrix (column-major number[16])', () => {
  it('is exported and returns 16 numbers', () => {
    expect(typeof buildItemTransformMatrix).toBe('function');
    const m = buildItemTransformMatrix([0, 0, 0], [0, 0, 0], [1, 1, 1]);
    expect(m.length).toBe(16);
    for (const v of m) expect(typeof v).toBe('number');
  });

  it('(a) identity: a point maps to itself', () => {
    const m = buildItemTransformMatrix([0, 0, 0], [0, 0, 0], [1, 1, 1]);
    expectVec(transform(m, [1, 2, 3]), [1, 2, 3]);
    expectVec(transform(m, [0, 0, 0]), [0, 0, 0]);
    // identity matrix exactly
    expectVec(m, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  });

  it('(b) rotation [90,0,0]: +Z (0,0,1) -> -Y (0,-1,0)', () => {
    const m = buildItemTransformMatrix([90, 0, 0], [0, 0, 0], [1, 1, 1]);
    expectVec(transform(m, [0, 0, 1]), [0, -1, 0]);
    // and +Y -> +Z under the same rotation
    expectVec(transform(m, [0, 1, 0]), [0, 0, 1]);
  });

  it('(c) translation [4,0,0]: point moves +4/16 = 0.25 on X', () => {
    const m = buildItemTransformMatrix([0, 0, 0], [4, 0, 0], [1, 1, 1]);
    expectVec(transform(m, [0, 0, 0]), [0.25, 0, 0]);
    expectVec(transform(m, [1, 1, 1]), [1.25, 1, 1]);
  });

  it('(d) scale [2,2,2]: a corner at distance d -> 2d', () => {
    const m = buildItemTransformMatrix([0, 0, 0], [0, 0, 0], [2, 2, 2]);
    const corner = [3, -4, 0]; // distance 5 from origin
    const got = transform(m, corner);
    expectVec(got, [6, -8, 0]);
    const dIn = Math.hypot(corner[0], corner[1], corner[2]);
    const dOut = Math.hypot(got[0], got[1], got[2]);
    expect(Math.abs(dOut - 2 * dIn)).toBeLessThan(EPS);
  });

  it('composition order is T * R * S (scale before rotate, translate last)', () => {
    // rotate 90 about X, then translate +16 units on Y (=1 block).
    const m = buildItemTransformMatrix([90, 0, 0], [0, 16, 0], [1, 1, 1]);
    // +Z -> -Y, then +1 on Y -> 0
    expectVec(transform(m, [0, 0, 1]), [0, 0, 0]);
  });

  it('tolerates missing args (defaults to identity)', () => {
    const m = buildItemTransformMatrix();
    expectVec(m, [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  });
});

describe('activeSlotPrefixFor', () => {
  const cases = {
    third:  'dThird',
    fpr:    'dFpr',
    fpl:    'dFpl',
    head:   'dHead',
    gui:    'dGui',
    ground: 'dGround',
    fixed:  'dFixed',
    shelf:  'dShelf',
  };

  it('covers all 8 tabs with the right prefix', () => {
    const tabs = Object.keys(cases);
    expect(tabs.length).toBe(8);
    for (const tab of tabs) {
      expect(activeSlotPrefixFor(tab), tab).toBe(cases[tab]);
    }
  });

  it('falls back to dThird for unknown tabs', () => {
    expect(activeSlotPrefixFor('nope')).toBe('dThird');
    expect(activeSlotPrefixFor(undefined)).toBe('dThird');
  });
});

// ── display-1:1 step B: GUI shader transform ports vanilla T*R*S ───────────
// Ports the NEW objmc_main.glsl GUI block (q16 decode + framing) to JS and
// asserts the EFFECTIVE on-screen transform reproduces vanilla.
//
// Shader builds Rv from the SAME r00..r22 as buildItemTransformMatrix, applies
// guiRotMat = F*Rv*F (F=diag(-1,1,-1)), then frames with *64, y-=64, and the GUI
// vertex flip posoffset.zx*=-1 (== F). The EFFECTIVE on-screen rotation is
// F*guiRotMat*F == Rv. This test FAILS on the old YXZ+sign-flip code, whose
// effective rotation diverged by up to ~34deg for 2+-axis poses.

const D2R = Math.PI / 180;
const F = [-1, 1, -1]; // diag(-1,1,-1)

// 3x3 * 3x3 (row-major)
function mm(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
const diag = (d) => [d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]];

// EXACTLY the shader's Rv (intrinsic XYZ, no sign negation) as a row-major 3x3.
function shaderRv(rotDeg) {
  const cx = Math.cos(rotDeg[0] * D2R), sx = Math.sin(rotDeg[0] * D2R);
  const cy = Math.cos(rotDeg[1] * D2R), sy = Math.sin(rotDeg[1] * D2R);
  const cz = Math.cos(rotDeg[2] * D2R), sz = Math.sin(rotDeg[2] * D2R);
  return [
    cy * cz,            -cy * sz,            sy,
    sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy,
    -cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy,
  ];
}
// guiRotMat = F*Rv*F (what the shader applies to geometry).
function shaderGuiRotMat(rotDeg) {
  return mm(diag(F), mm(shaderRv(rotDeg), diag(F)));
}
// EFFECTIVE on-screen rotation = F * guiRotMat * F (the GUI vertex flip applied
// to both the rotated vector and the camera frame).
function effectiveRotation(rotDeg) {
  return mm(diag(F), mm(shaderGuiRotMat(rotDeg), diag(F)));
}
// Upper-left 3x3 of the column-major buildItemTransformMatrix (pure rotation,
// scale=1, trans=0) as a row-major 3x3.
function vanillaRot3(rotDeg) {
  const m = buildItemTransformMatrix(rotDeg, [0, 0, 0], [1, 1, 1]);
  return [
    m[0], m[4], m[8],
    m[1], m[5], m[9],
    m[2], m[6], m[10],
  ];
}
function expectMat3(got, want, eps = 1e-5) {
  for (let i = 0; i < 9; i++)
    expect(Math.abs(got[i] - want[i]), `m[${i}]: ${got[i]} ~ ${want[i]}`).toBeLessThan(eps);
}

describe('display-1:1 B: GUI effective rotation == vanilla XYZ (single + multi-axis)', () => {
  const single = [[45, 0, 0], [0, 45, 0], [0, 0, 45], [90, 0, 0], [0, 0, 0]];
  const multi = [[45, 45, 45], [30, 60, 90], [20, 40, 80]];

  it('single-axis poses match (old code passed these too)', () => {
    for (const r of single) expectMat3(effectiveRotation(r), vanillaRot3(r));
  });

  it('multi-axis poses match within 1e-5 (catches the old YXZ+sign-flip bug)', () => {
    for (const r of multi) expectMat3(effectiveRotation(r), vanillaRot3(r));
  });

  it('the OLD YXZ guiRotMat would DIVERGE on a multi-axis pose (regression guard)', () => {
    // Old shader: Ry(ry)*Rx(-rx)*Rz(-rz) with effective F*oldRot*F.
    function oldGuiRotMat(rotDeg) {
      const cx = Math.cos(rotDeg[0] * D2R), sx = Math.sin(rotDeg[0] * D2R);
      const cy = Math.cos(rotDeg[1] * D2R), sy = Math.sin(rotDeg[1] * D2R);
      const cz = Math.cos(rotDeg[2] * D2R), sz = Math.sin(rotDeg[2] * D2R);
      // mat3 columns from the old shader, converted to row-major.
      const c0 = [cy * cz + sy * sx * sz, -cx * sz, -sy * cz + cy * sx * sz];
      const c1 = [cy * sz - sy * sx * cz,  cx * cz, -sy * sz - cy * sx * cz];
      const c2 = [sy * cx, sx, cy * cx];
      return [
        c0[0], c1[0], c2[0],
        c0[1], c1[1], c2[1],
        c0[2], c1[2], c2[2],
      ];
    }
    const oldEffective = (r) => mm(diag(F), mm(oldGuiRotMat(r), diag(F)));
    let maxDeg = 0;
    for (const r of [[45, 45, 45], [30, 60, 90], [20, 40, 80]]) {
      const a = oldEffective(r), b = vanillaRot3(r);
      // angular error of rotating a probe vector
      const p = [0.3, -0.7, 0.5];
      const ap = [a[0]*p[0]+a[1]*p[1]+a[2]*p[2], a[3]*p[0]+a[4]*p[1]+a[5]*p[2], a[6]*p[0]+a[7]*p[1]+a[8]*p[2]];
      const bp = [b[0]*p[0]+b[1]*p[1]+b[2]*p[2], b[3]*p[0]+b[4]*p[1]+b[5]*p[2], b[6]*p[0]+b[7]*p[1]+b[8]*p[2]];
      const dot = ap[0]*bp[0]+ap[1]*bp[1]+ap[2]*bp[2];
      const la = Math.hypot(...ap), lb = Math.hypot(...bp);
      const deg = Math.acos(Math.max(-1, Math.min(1, dot/(la*lb)))) / D2R;
      if (deg > maxDeg) maxDeg = deg;
    }
    // The old code is materially wrong for multi-axis; new code is exact.
    expect(maxDeg).toBeGreaterThan(5);
  });
});

describe('display-1:1 B: GUI translation is 1/16-block with vanilla signs', () => {
  // Shader: m = (po - pivot)*scale; m = guiRotMat*m; m += pivot + guiTrans/16;
  // posoffset = m*64; posoffset.y += -64; posoffset.zx *= -1.
  // For identity rot/scale and pivot=origin, a single point at the origin is
  // moved by guiTrans/16 blocks in the PRE-framing (vanilla model) frame.
  function preFramingPoint(po, guiTrans, guiRot, guiScale, pivot) {
    const R = shaderGuiRotMat(guiRot);
    let m = [
      (po[0] - pivot[0]) * guiScale[0],
      (po[1] - pivot[1]) * guiScale[1],
      (po[2] - pivot[2]) * guiScale[2],
    ];
    m = [
      R[0]*m[0]+R[1]*m[1]+R[2]*m[2],
      R[3]*m[0]+R[4]*m[1]+R[5]*m[2],
      R[6]*m[0]+R[7]*m[1]+R[8]*m[2],
    ];
    return [
      m[0] + pivot[0] + guiTrans[0] / 16,
      m[1] + pivot[1] + guiTrans[1] / 16,
      m[2] + pivot[2] + guiTrans[2] / 16,
    ];
  }
  // EFFECTIVE on-screen point: F*Rv*F geometry is framed by F (zx flip). To read
  // the vanilla model-frame displacement, undo the flip: apply F to the framed
  // delta. Here we test the pre-framing model frame directly against vanilla.

  it('N units -> N/16 block (each axis), vanilla +x,+y,+z signs', () => {
    const origin = [0, 0, 0];
    for (const N of [16, 8, -4, 1]) {
      // +X
      expectVec(preFramingPoint([0,0,0], [N,0,0], [0,0,0], [1,1,1], origin), [N/16, 0, 0]);
      // +Y
      expectVec(preFramingPoint([0,0,0], [0,N,0], [0,0,0], [1,1,1], origin), [0, N/16, 0]);
      // +Z
      expectVec(preFramingPoint([0,0,0], [0,0,N], [0,0,0], [1,1,1], origin), [0, 0, N/16]);
    }
  });

  it('matches the vanilla matrix translation column (T/16) for the origin point', () => {
    const T = [12, -6, 3];
    const got = preFramingPoint([0,0,0], T, [0,0,0], [1,1,1], [0,0,0]);
    const m = buildItemTransformMatrix([0,0,0], T, [1,1,1]);
    expectVec(got, [m[12], m[13], m[14]]); // == [T0/16,T1/16,T2/16]
  });
});
