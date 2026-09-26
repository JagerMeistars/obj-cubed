import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatePortableOit } from './generate.mjs';
import { assetsDirectory, expandShader } from '../../../test/helpers/shader-includes.mjs';

// This is a compiler integration check against real vanilla includes. Every
// shader exercises both the ordinary path and a reconstructed clip-space hit.
const [vanillaRoot, outputArgument] = process.argv.slice(2);
if (!vanillaRoot) {
  console.error('Usage: node tools/portable-renderer/oit/verify.mjs VANILLA_ROOT [OUTPUT_DIR]');
  process.exit(2);
}
const output = path.resolve(outputArgument ?? 'work/portable-oit-validation');
const crossCompiler = process.env.SPIRV_CROSS;
const pack = path.join(output, 'pack');
const includes = path.join(pack, 'assets/minecraft/shaders/include');
const metadata = generatePortableOit(path.join(assetsDirectory(vanillaRoot), 'minecraft/shaders/include'), includes);
const phases = [
  ['opaque', []],
  ['bounds', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_DEPTH_BOUNDS']],
  ['transmittance', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_TRANSMITTANCE']],
  ['accumulate', ['OIT', 'OIT_ACCUMULATE']],
  ['additive-bounds', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_DEPTH_BOUNDS', 'OIT_ADDITIVE']],
  ['additive-transmittance', ['OIT', 'OIT_ALPHA_ONLY', 'OIT_TRANSMITTANCE', 'OIT_ADDITIVE']],
  ['additive-accumulate', ['OIT', 'OIT_ACCUMULATE', 'OIT_ADDITIVE']],
];
let compiled = 0;
const gpuCases = [];
for (const [phase, definitions] of phases) {
  for (const coefficients of phase === 'opaque' ? [4] : [4, 8, 16]) {
    for (const zeroToOne of [false, true]) {
      for (const explicitDepth of [false, true]) {
        const id = `${phase}-${coefficients}-${zeroToOne ? 'z01' : 'z11'}-${explicitDepth ? 'invariant' : 'normal'}`;
        const defines = [...definitions, `OIT_COEFF_COUNT ${coefficients}`, `OIT_COEFF_ATTACHMENT_COUNT ${coefficients / 4}`, `OIT_WAVELET_RANK ${Math.log2(coefficients) - 1}`];
        if (zeroToOne) defines.push('RENDERPEARL_DEPTH_IS_ZERO_TO_ONE');
        if (explicitDepth) defines.push('RENDERPEARL_EXPLICIT_DEPTH_INVARIANCE');
        const source = `#version 450
${defines.map(define => '#define ' + define).join('\n')}
#include <minecraft:objmc_oit.glsl>
layout(std140) uniform TestInput {
    vec4 hitClip;
    int custom;
    float alpha;
};
#ifndef OIT_ALPHA_ONLY
layout(location = 0) out vec4 colorOutput;
#endif
void main() {
    oc_init_fragment_depth();
    if (custom != 0) {
        float depth;
        if (!oc_project_fragment_depth(hitClip, depth)) discard;
        oc_set_fragment_depth(depth);
    }
#ifdef OIT_ALPHA_ONLY
    // Existing core callers may still supply the proxy's rasterized depth.
    executeAlphaOnlyPhase(gl_FragCoord.z, alpha);
#else
    vec4 color = vec4(0.7, 0.4, 0.2, alpha);
#ifdef OIT_ACCUMULATE
    colorOutput = sampleColorForAccumulation(color);
#else
    colorOutput = color;
#endif
#endif
}
`;
        const input = path.join(output, id + '.frag');
        fs.writeFileSync(input, source);
        const expanded = path.join(output, id + '.expanded.frag');
        fs.writeFileSync(expanded, expandShader(input, [pack, vanillaRoot]));
        const referenceInput = path.join(output, id + '.reference.frag');
        const referenceSource = source
          .replace('<minecraft:objmc_oit.glsl>', '<minecraft:oit.glsl>')
          .replace('oc_init_fragment_depth();', 'gl_FragDepth = gl_FragCoord.z;')
          .replace(/    if \(custom != 0\) \{\n[\s\S]*?\n    \}/, '');
        fs.writeFileSync(referenceInput, referenceSource);
        const referenceExpanded = path.join(output, id + '.reference.expanded.frag');
        fs.writeFileSync(referenceExpanded, expandShader(referenceInput, [vanillaRoot]));
        const driverSources = [];
        for (const [label, input] of [['custom', expanded], ['reference', referenceExpanded]]) {
          const spirv = path.join(output, `${id}.${label}.spv`);
          const result = spawnSync(process.env.GLSLC ?? 'glslc', ['--target-env=vulkan1.2', '-fauto-bind-uniforms', input, '-o', spirv], { encoding: 'utf8' });
          if (result.error || result.status !== 0) {
            throw new Error(`${id}/${label}: ${result.error ?? result.stderr ?? result.stdout}`);
          }
          if (crossCompiler) {
            const translated = path.join(output, `${id}.${label}.opengl.glsl`);
            const cross = spawnSync(crossCompiler, [spirv, '--version', '330', '--no-es', '--no-420pack-extension',
              '--glsl-emit-push-constant-as-ubo', '--force-zero-initialized-variables', '--flatten-multidimensional-arrays',
              '--output', translated], {encoding: 'utf8'});
            if (cross.error || cross.status !== 0) throw new Error(`${id}/${label} translation: ${cross.error ?? cross.stderr}`);
            driverSources.push(translated);
          }
          compiled++;
        }
        if (crossCompiler) gpuCases.push([id, ...driverSources, phase.includes('transmittance') ? coefficients / 4 : 1, Number(zeroToOne)].join('\t'));
      }
    }
  }
}
const summary = { compiled, phases: phases.map(([name]) => name), coefficientCounts: [4, 8, 16], zeroToOne: [false, true], explicitDepthInvariance: [false, true], ...metadata };
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
if (crossCompiler) fs.writeFileSync(path.join(output, 'gpu-cases.tsv'), gpuCases.join('\n') + '\n');
console.log(`PASS: ${compiled} Vulkan 1.2 fragment shader variants; report ${path.join(output, 'summary.json')}`);
