#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { expandShader, shaderIncludes, includePath } from './helpers/shader-includes.mjs';
import { shaderMatrix } from './helpers/shader-matrix.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pack = path.join(root, 'objcubed');
const args = process.argv.slice(2);
let vanilla = process.env.MC_VANILLA_ASSETS;
let compile = false;
let compiler = 'all';
let output;
let target = 'vulkan1.2';
let crossCompiler;
let driver;
let glVersion = '4.5';
let programFilter;
let progress = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--compile') compile = true;
  else if (args[i] === '--vanilla') vanilla = args[++i];
  else if (args[i] === '--compiler') compiler = args[++i];
  else if (args[i] === '--output') output = args[++i];
  else if (args[i] === '--target') target = args[++i];
  else if (args[i] === '--spirv-cross') crossCompiler = args[++i];
  else if (args[i] === '--driver') driver = args[++i];
  else if (args[i] === '--gl-version') glVersion = args[++i];
  else if (args[i] === '--filter') programFilter = new RegExp(args[++i]);
  else if (args[i] === '--progress') progress = true;
  else if (args[i] === '--pack') pack = path.resolve(args[++i]);
  else throw new Error(`Unknown option: ${args[i]}`);
}
assert(['all', 'glslc', 'glslangValidator'].includes(compiler), 'Compiler must be all, glslc or glslangValidator');
assert(['vulkan1.2', 'opengl'].includes(target), 'Target must be vulkan1.2 (Minecraft 26.3) or opengl (diagnostic only)');
assert(!driver || crossCompiler, '--driver requires --spirv-cross: test the Minecraft 26.3 round trip');
const core = path.join(pack, 'assets/minecraft/shaders/core');

function* files(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else yield file;
  }
}

const meta = JSON.parse(fs.readFileSync(path.join(pack, 'pack.mcmeta'), 'utf8'));
assert.deepEqual(meta.pack.min_format, [97, 1], 'Resource pack must target Minecraft 26.3 (97.1)');
assert.deepEqual(meta.pack.max_format, [97, 1], 'Do not advertise untested format versions');
const require = createRequire(import.meta.url);
const api = require('./helpers/load-plugin.cjs').loadObjcubed();
const generated = api.generateDatapackFiles('validate', 2, 'objcubed', 'item_display', null, 'stick', 'validate');
const dataMeta = JSON.parse(generated.get('pack.mcmeta'));
assert.deepEqual(dataMeta.pack.min_format, [121, 0], 'Data pack must target Minecraft 26.3 (121.0)');
assert.deepEqual(dataMeta.pack.max_format, [121, 0]);

let shaders = 0;
const roots = vanilla ? [pack, vanilla] : [pack];
for (const file of files(pack)) {
  if (/\.(?:json|mcmeta)$/.test(file)) JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/\.(?:vsh|fsh|glsl)$/.test(file)) continue;
  shaders++;
  const source = fs.readFileSync(file, 'utf8');
  assert(source.trim(), `Empty shader: ${file}`);
  assert(!/#moj_import\b/.test(source), `26.3 uses #include: ${file}`);
  const activeSource = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  assert(!/\bsubgroup(?:Quad|Shuffle)\w*\s*\(/.test(activeSource), `SPIRV-Cross cannot translate quad/shuffle operations for OpenGL: ${file}`);
  assert(!/GL_KHR_shader_subgroup_(?:quad|shuffle(?:_relative)?)\b/.test(activeSource), `Unsupported OpenGL translation dependency: ${file}`);
  for (const resource of shaderIncludes(source)) {
    // Vanilla's includes are not redistributed with this project. Resolve all
    // custom imports offline and the complete graph when --vanilla is supplied.
    if (vanilla || resource.includes(':objmc_')) includePath(resource, roots);
  }
}
for (const kind of ['item', 'entity', 'block', 'terrain']) {
  for (const extension of ['vsh', 'fsh']) assert(fs.existsSync(path.join(core, `${kind}.${extension}`)));
}
console.log(`Pack validation passed (${shaders} shader files; resource format 97.1, data format 121.0).`);
if (fs.existsSync(path.join(pack, 'OPENGL-ONLY.txt'))) console.log('OPENGL-ONLY variant: Vulkan 1.2 is the compiler input format, not a supported runtime backend for this pack.');

if (compile) {
  assert(vanilla, 'Shader compilation requires --vanilla <extracted-client-root-or-assets-dir> or MC_VANILLA_ASSETS');
  const requested = compiler === 'all' ? ['glslc', 'glslangValidator'] : [compiler];
  const available = requested.filter(tool => spawnSync(tool, ['--version'], {encoding: 'utf8'}).status === 0);
  assert(available.length > 0, `Install a shader compiler: ${requested.join(' or ')}`);
  assert(!crossCompiler || (target === 'vulkan1.2' && available.includes('glslc')), '--spirv-cross requires the glslc compiler and vulkan1.2 target');
  if (available.length !== requested.length) console.log(`Compiler unavailable: ${requested.filter(tool => !available.includes(tool)).join(', ')}`);
  const scratch = output ? path.resolve(output) : fs.mkdtempSync(path.join(os.tmpdir(), 'objcubed-shaders-'));
  fs.mkdirSync(scratch, {recursive: true});
  let stages = 0;
  let links = 0;
  let roundTrips = 0;
  let driverLinks = 0;
  let driverDescription;
  const failures = [];
  try {
    const programs = shaderMatrix().filter(program => !programFilter || programFilter.test(program.name));
    assert(programs.length, 'No shader programs matched --filter');
    for (const program of programs) {
      if (progress) console.log(`Checking ${program.name}`);
      const inputs = ['vsh', 'fsh'].map((extension, index) => {
        const destination = path.join(scratch, `${program.name}.${index === 0 ? 'vert' : 'frag'}`);
        const source = expandShader(path.join(core, `${program.kind}.${extension}`), roots);
        fs.writeFileSync(destination, source);
        return destination;
      });
      const defines = program.defines.map(value => `-D${value}`);
      const driverInputs = [];
      if (available.includes('glslc')) {
        for (const input of inputs) {
          const spirv = `${input}.spv`;
          const result = spawnSync('glslc', [`--target-env=${target}`, ...(target === 'opengl' ? ['--target-spv=spv1.3'] : []), '-fauto-bind-uniforms',
            ...defines, input, '-o', spirv], {encoding: 'utf8'});
          stages++;
          if (result.status !== 0) failures.push(`${path.basename(input)} (glslc):\n${result.stderr || result.error}`);
          else if (crossCompiler) {
            const translated = `${input}.opengl.glsl`;
            const cross = spawnSync(crossCompiler, [spirv, '--version', '330', '--no-es', '--no-420pack-extension',
              '--glsl-emit-push-constant-as-ubo', '--force-zero-initialized-variables', '--flatten-multidimensional-arrays',
              '--output', translated], {encoding: 'utf8'});
            roundTrips++;
            if (cross.status !== 0) failures.push(`${path.basename(input)} (SPIRV-Cross GLSL 330):\n${cross.stderr || cross.error}`);
            else driverInputs.push(translated);
          }
        }
      }
      if (available.includes('glslangValidator')) {
        const result = spawnSync('glslangValidator', [target === 'opengl' ? '-G' : '-V', '--target-env', target === 'opengl' ? 'spirv1.3' : target, '--auto-map-bindings',
          '-l', ...defines, ...inputs, '-o', path.join(scratch, 'glslang.spv')], {encoding: 'utf8'});
        links++;
        if (result.status !== 0) failures.push(`${program.name} (glslangValidator link):\n${result.stdout}${result.stderr || result.error || ''}`);
      }
      if (driver && driverInputs.length === 2) {
        const result = spawnSync(path.resolve(driver), [...driverInputs, glVersion], {encoding: 'utf8'});
        driverLinks++;
        driverDescription ||= result.stdout?.split('\n')[0];
        if (result.status !== 0) failures.push(`${program.name} (OpenGL driver):\n${result.stdout}${result.stderr || result.error || ''}`);
      }
    }
    if (driverDescription) console.log(driverDescription);
    console.log(`Executed ${target}: ${stages} glslc stages, ${links} glslang links, ${roundTrips} GLSL 330 translation attempts, ${driverLinks} driver links.`);
    if (failures.length) throw new Error(`${failures.length} compiler failures (first 12 shown):\n${failures.slice(0, 12).join('\n')}`);
    console.log('All requested shader validation stages passed.');
    if (!crossCompiler) console.log('SPIRV-Cross was not requested; OpenGL runtime translation has not been checked.');
    console.log('Compilation does not replace rendering checks in a vanilla Minecraft 26.3 client.');
  } finally {
    if (!output) fs.rmSync(scratch, {recursive: true, force: true});
  }
}
