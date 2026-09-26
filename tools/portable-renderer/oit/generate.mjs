import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const vanillaFiles = [
  'oit.glsl', 'oit_common.glsl', 'oit_depth_sample.glsl',
  'oit_depth_bounds.glsl', 'oit_add_transmittance.glsl', 'oit_sample.glsl',
];

function replaceExactly(source, needle, replacement, expected, name) {
  const actual = source.split(needle).length - 1;
  if (actual !== expected) {
    throw new Error(`${name}: expected ${expected} occurrences of ${JSON.stringify(needle)}, got ${actual}; inspect this Minecraft version before adapting its OIT helpers`);
  }
  return source.split(needle).join(replacement);
}

// Generate private copies instead of overriding vanilla's includes for every
// Minecraft pipeline. Their public helper signatures remain vanilla-compatible.
export function generatePortableOit(vanillaIncludeDir, outputIncludeDir) {
  const output = {};
  const sourceSha256 = {};
  for (const name of vanillaFiles) {
    const original = fs.readFileSync(path.join(vanillaIncludeDir, name), 'utf8');
    sourceSha256[name] = createHash('sha256').update(original).digest('hex');
    let source = original.replaceAll('\r\n', '\n');
    source = source.replaceAll('MINECRAFT_OIT_', 'OBJMC_OIT_');
    source = source.replace(/#include <minecraft:(oit(?:_[a-z_]+)?\.glsl)>/g,
      '#include <minecraft:objmc_$1>');
    if (name === 'oit.glsl') {
      source = replaceExactly(source, '#define OBJMC_OIT_GLSL',
        '#define OBJMC_OIT_GLSL\n\n#include <minecraft:objmc_fragment_depth.glsl>', 1, name);
    }
    if (name === 'oit_depth_bounds.glsl') {
      source = replaceExactly(source,
        'void calculateDepthBounds(float fragmentDeviceDepth, float alpha) {',
        'void calculateDepthBounds(float fragmentDeviceDepth, float alpha) {\n    fragmentDeviceDepth = oc_resolve_fragment_device_depth(fragmentDeviceDepth);',
        1, name);
    }
    if (name === 'oit_add_transmittance.glsl' || name === 'oit_sample.glsl') {
      source = replaceExactly(source, 'gl_FragCoord.z', 'oc_fragment_device_depth()', 2, name);
    }
    // Other transitive helpers take device depth explicitly. Keep their math
    // and screen-pixel addressing byte-for-byte apart from private include names.
    if (/gl_FragCoord\.z/.test(source)) {
      throw new Error(`${name}: an unadapted proxy-depth read remains`);
    }
    output[`objmc_${name}`] = '// Generated from Minecraft 26.3; custom hits use reconstructed device depth.\n' + source;
  }
  output['objmc_fragment_depth.glsl'] = fs.readFileSync(path.join(directory, 'objmc_fragment_depth.glsl'), 'utf8');
  fs.mkdirSync(outputIncludeDir, { recursive: true });
  for (const [name, source] of Object.entries(output)) {
    fs.writeFileSync(path.join(outputIncludeDir, name), source);
  }
  return { files: Object.keys(output), sourceSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [vanillaIncludeDir, outputIncludeDir] = process.argv.slice(2);
  if (!vanillaIncludeDir || !outputIncludeDir) {
    console.error('Usage: node tools/portable-renderer/oit/generate.mjs VANILLA_INCLUDE_DIR OUTPUT_INCLUDE_DIR');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(generatePortableOit(vanillaIncludeDir, outputIncludeDir), null, 2));
  }
}
