// Geometry features used by the Minecraft 26.3 core pipelines. Each program is
// compiled with opaque, cutout and all three OIT passes, plus depth conventions.
const geometry = {
  item: [[], ['GLINT'], ['GLINT', 'GLINT_SPECIAL']],
  entity: [[], ['NO_OVERLAY'], ['NO_CARDINAL_LIGHTING', 'NO_OVERLAY', 'EMISSIVE'],
    ['PER_FACE_LIGHTING'], ['DISSOLVE'], ['APPLY_TEXTURE_MATRIX'], ['GLINT']],
  block: [[]],
  terrain: [[], ['MULTIDRAW_TERRAIN']],
};
const passes = [
  ['opaque', []],
  ['cutout', ['ALPHA_CUTOUT=0.1']],
  ['depth-bounds', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_DEPTH_BOUNDS']],
  ['transmittance', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_TRANSMITTANCE']],
  ['accumulate', ['OIT', 'OIT_ACCUMULATE']],
];

export function shaderMatrix() {
  const programs = [];
  for (const [kind, variants] of Object.entries(geometry)) {
    for (const variant of variants) {
      for (const [pass, defines] of passes) {
        programs.push({kind, name: [kind, ...variant, pass].join('-'), defines: [
          ...variant, ...defines, 'OIT_COEFF_COUNT=8', 'OIT_COEFF_ATTACHMENT_COUNT=2', 'OIT_WAVELET_RANK=2',
        ]});
      }
    }
    // Cover both additional coefficient layouts, additive transparency, and
    // the zero-to-one/reversed-depth backend defines without a huge Cartesian product.
    for (const coefficients of [4, 16]) {
      for (const pass of ['OIT_TRANSMITTANCE', 'OIT_ACCUMULATE']) {
        programs.push({kind, name: `${kind}-${pass}-${coefficients}-depth`, defines: [
          'OIT', pass, ...(pass === 'OIT_TRANSMITTANCE' ? ['OIT_ALPHA_ONLY'] : ['OIT_ADDITIVE']),
          'ALPHA_CUTOUT=0.1', 'RENDERPEARL_DEPTH_IS_ZERO_TO_ONE', 'RENDERPEARL_EXPLICIT_DEPTH_INVARIANCE',
          `OIT_COEFF_COUNT=${coefficients}`, `OIT_COEFF_ATTACHMENT_COUNT=${coefficients / 4}`,
          `OIT_WAVELET_RANK=${Math.log2(coefficients) - 1}`,
        ]});
      }
    }
  }
  return programs;
}
