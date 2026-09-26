#!/usr/bin/env node
// Copy a resource pack into a NEW directory and apply the optional OpenGL path.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const helper = fs.readFileSync(path.join(here, 'opengl-compat/objmc_carrier.glsl'), 'utf8');
const armorHelper = fs.readFileSync(path.join(here, 'opengl-compat/objmc_armor_carrier.glsl'), 'utf8');
const notice = `obj³ 26.3 — EXPERIMENTAL OPENGL-ONLY COMPATIBILITY PACK

Select Minecraft's OpenGL renderer BEFORE enabling this pack.
Do not use this pack with the Vulkan renderer: vanilla Minecraft 26.3 does not
activate the Vulkan features required by this legacy shader translation path.
Use the regular obj³ resource pack when using Vulkan.

This variant requires vertex-stage GL_ARB_shader_ballot,
GL_ARB_gpu_shader_int64 and GL_ARB_shader_draw_parameters support.
AMD Renoir and NVIDIA GTX 1650 were tested. Intel graphics are unverified.
Apple OpenGL is unsupported. This is not a universal replacement for subgroup
access and cannot run on drivers lacking the required extensions.

Prepare exported item assets with tools/prepare-opengl-models.mjs to add invisible
carrier guards. Unprepared models can lose faces at model-instance boundaries.
The original vertex decoder, animation and texture paths remain active.
Armor uses physical cube corners; its sparse two-point fallback uses the packed
normal and is approximate. The supported pose is vanilla humanoid armor.

Enable this pack above other packs overriding the same core shaders. Re-export
models with the 26.3 plugin for the explicit first-person context markers.
`;

function contains(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function rejectSymlinks(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not supported in pack inputs: ${file}`);
    if (entry.isDirectory()) rejectSymlinks(file);
  }
}

export function buildOpenGLPack(input, output) {
  if (!input || !output) throw new Error('Usage: node tools/build-opengl-pack.mjs <source-resource-pack> <new-output-directory>');
  const source = fs.realpathSync(input);
  const requested = path.resolve(output);
  // Resolve the existing parent so a symlink cannot hide an output inside input.
  // Requiring an existing parent avoids creating unrelated directory trees.
  const destination = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  if (contains(source, destination) || contains(destination, source)) throw new Error('Input and output must be separate, non-nested directories');
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite existing output: ${destination}`);
  rejectSymlinks(source);
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'pack.mcmeta'), 'utf8'));
  if (JSON.stringify(metadata.pack?.min_format) !== '[97,1]' || JSON.stringify(metadata.pack?.max_format) !== '[97,1]') {
    throw new Error('Input must be the Minecraft 26.3 resource pack (format 97.1)');
  }
  const patches = new Map();
  for (const kind of ['item', 'entity', 'block', 'terrain']) {
    const relative = `assets/minecraft/shaders/core/${kind}.vsh`;
    let shader = fs.readFileSync(path.join(source, relative), 'utf8');
    for (const [from, to] of [['GL_KHR_shader_subgroup_basic', 'GL_ARB_gpu_shader_int64'], ['GL_KHR_shader_subgroup_ballot', 'GL_ARB_shader_ballot']]) {
      const directive = new RegExp(`^#extension ${from}\\s*:\\s*require\\s*$`, 'gm');
      if ([...shader.matchAll(directive)].length !== 1) throw new Error(`Expected exactly one ${from} requirement in ${relative}`);
      shader = shader.replace(directive, `#extension ${to} : require`);
    }
    shader = shader.replace('#extension GL_ARB_shader_ballot : require',
      '#extension GL_ARB_shader_ballot : require\n#extension GL_ARB_shader_draw_parameters : require' +
      (kind === 'terrain' ? '\n#define OBJMC_CARRIER_TERRAIN' : '') +
      (kind === 'item' || kind === 'entity' ? '\n#define OBJMC_CARRIER_ARMOR' : ''));
    patches.set(relative, shader);
  }
  metadata.pack.description = '[OPENGL ONLY] obj³ 26.3 EXPERIMENTAL — choose OpenGL renderer';
  patches.set('pack.mcmeta', JSON.stringify(metadata, null, 2) + '\n');
  patches.set('assets/minecraft/shaders/include/objmc_carrier.glsl', helper);
  patches.set('assets/minecraft/shaders/include/objmc_armor_carrier.glsl', armorHelper);
  patches.set('OPENGL-ONLY.txt', notice);
  fs.mkdirSync(destination);
  try {
    fs.cpSync(source, destination, {recursive: true, errorOnExist: true, force: false});
    for (const [relative, contents] of patches) fs.writeFileSync(path.join(destination, relative), contents);
  } catch (error) {
    fs.rmSync(destination, {recursive: true, force: true});
    throw error;
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`OpenGL-only pack written to ${buildOpenGLPack(process.argv[2], process.argv[3])}`);
}
