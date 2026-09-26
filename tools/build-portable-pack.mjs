#!/usr/bin/env node
// Vanilla 26.3 fragment reconstruction renderer. This variant never reads
// another vertex invocation: the rasterizer transports each affine carrier.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generatePortableOit} from './portable-renderer/oit/generate.mjs';
import {specializeArmorSources} from './portable-renderer/specialize-armor.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, 'portable-renderer', name), 'utf8');
const varying = direction => `
layout(location=0) ${direction} vec4 oc_p0;
layout(location=1) ${direction} vec4 oc_p1;
layout(location=2) ${direction} vec4 oc_p2;
layout(location=3) ${direction} vec4 oc_p3;
layout(location=4) ${direction} vec4 oc_uv01;
layout(location=5) ${direction} vec4 oc_uv23;
layout(location=6) ${direction} vec4 oc_high01;
layout(location=7) ${direction} vec4 oc_high12;
layout(location=8) ${direction} vec4 oc_high23;
layout(location=9) flat ${direction} vec4 oc_decoded0;
layout(location=10) flat ${direction} vec4 oc_decoded1;
layout(location=11) flat ${direction} vec4 oc_decoded2;
layout(location=12) flat ${direction} vec4 oc_decoded_uv01;
layout(location=13) flat ${direction} vec4 oc_decoded_uv23;
layout(location=14) flat ${direction} vec4 oc_parameters;
layout(location=15) flat ${direction} uvec4 oc_packed;
`;

export function buildPortablePack(source, destination, vanilla) {
  if(!source || !destination || !vanilla) throw new Error('Usage: node tools/build-portable-pack.mjs SOURCE_PACK NEW_OUTPUT VANILLA_SHADER_DIRECTORY');
  source = fs.realpathSync(source);
  const requested=path.resolve(destination);
  destination=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
  const inputMetadata=JSON.parse(fs.readFileSync(path.join(source,'pack.mcmeta'),'utf8'));
  if(JSON.stringify(inputMetadata.pack?.min_format)!=='[97,1]' || JSON.stringify(inputMetadata.pack?.max_format)!=='[97,1]')
    throw new Error('Source must target Minecraft 26.3 resource format 97.1');
  fs.accessSync(path.join(vanilla,'include/oit.glsl'));
  if (fs.existsSync(destination)) throw new Error('Output must be a new directory');
  if (destination.startsWith(source + path.sep) || source.startsWith(destination + path.sep)) throw new Error('Input/output must be separate');
  const shaders = path.join(source, 'assets/minecraft/shaders');
  const result = path.join(destination, 'assets/minecraft/shaders');
  try {
  fs.cpSync(source, destination, {recursive:true});
  let tools = fs.readFileSync(path.join(shaders,'include/objmc_tools.glsl'),'utf8').replace(/\/\/ Minecraft 26\.3[\s\S]*?#include <minecraft:objmc_carrier.glsl>/, `#define OBJMC_VERTEX_ID oc_virtual_id
void oc_read_carrier(vec3 p, vec2 uv, out vec3 positions[4], out vec2 uvs[4]) {
    for (int i=0;i<4;i++) { positions[i]=oc_carrier_positions[i]; uvs[i]=oc_carrier_uvs[i]; }
}`);
  tools=tools.replace('int i = index*3;', 'if(oc_basis_mode) return oc_virtual_id==0?vec3(0.0):oc_virtual_id==1?vec3(1.0,0.0,0.0):oc_virtual_id==2?vec3(0.0,1.0,0.0):vec3(0.0,0.0,1.0);\n    int i = index*3;');
  fs.writeFileSync(path.join(result,'include/objmc_tools.glsl'), tools);
  // Remove the unused subgroup implementation as well, making the whole pack
  // inspectably free of subgroup, ballot, shuffle and 64-bit requirements.
  fs.rmSync(path.join(result,'include/objmc_carrier.glsl'));
  for (const file of ['carrier.glsl','decode.glsl','item-affine.glsl','fragment.glsl','vertex.glsl','bvh.glsl','armor-fast.glsl','armor-bounds.glsl','armor-early.glsl','armor-affine.glsl','armor-bvh.glsl','glint.glsl'])
    fs.writeFileSync(path.join(result,'include',`objmc_portable_${file}`),read(file));
  const armorOnly=specializeArmorSources({vertex:read('vertex.glsl'),fragment:read('fragment.glsl'),decode:read('decode.glsl')});
  for(const [name,source]of Object.entries(armorOnly))
    fs.writeFileSync(path.join(result,'include',`objmc_portable_armor-only-${name}.glsl`),source);
  let originalMain=fs.readFileSync(path.join(result,'include/objmc_main.glsl'),'utf8');
  originalMain=originalMain.replace('//relative vertex id from unique face uv', 'oc_animation_frame=frame; oc_animation_mix=fract(time*float(nframes)/duration); oc_animation_easing=easing.x; oc_animation_frames=nframes;\n        //relative vertex id from unique face uv');
  fs.writeFileSync(path.join(result,'include/objmc_main.glsl'), originalMain.replace('bvec3 visibility = bvec3(getb(t[6].r, 4), getb(t[6].r, 3), getb(t[6].r, 2));', 'bvec3 visibility = bvec3(getb(t[6].r, 4), getb(t[6].r, 3), getb(t[6].r, 2));\n#ifdef OC_PORTABLE_VERTEX\nvisibility=bvec3(true);\n#endif'));
  const lightFile=path.join(result,'include/objmc_light.glsl');
  fs.writeFileSync(lightFile,fs.readFileSync(lightFile,'utf8').replace('normalize(cross(dFdx(Pos), dFdy(Pos)))','oc_surface_normal'));
  generatePortableOit(path.join(vanilla,'include'),path.join(result,'include'));
  for (const kind of ['item','entity','block','terrain']) {
    const vs = fs.readFileSync(path.join(shaders,'core',`${kind}.vsh`),'utf8');
    const fsOriginal = fs.readFileSync(path.join(shaders,'core',`${kind}.fsh`),'utf8');
    const header = vs.slice(0,vs.indexOf('layout(location = 0) out'))
      .replace(/#version \d+/, '#version 330')
      .replace(/#extension .*\n/g,'');
    const globals = vs.slice(vs.indexOf('layout(location = 0) out'),vs.indexOf('#include <minecraft:objmc_tools.glsl>'))
      .replace(/layout\(location = \d+\) (flat )?out /g,'');
    const body = vs.slice(vs.indexOf('void main()'))
      .replace(/    #define (ENTITY|BLOCK)\n    #include <minecraft:objmc_main.glsl>/,'')
      .replace(/}\s*$/, '    oc_portable_vertex();\n}\n');
    const defines = `#define OC_PORTABLE_PRECISE\n#define OC_PORTABLE_ARMOR_BOUNDS\n#define OC_${kind.toUpperCase()}\n#define ${kind==='item'||kind==='entity'?'ENTITY':'BLOCK'}\n#if defined(OC_ENTITY) && defined(NO_OVERLAY) && defined(PER_FACE_LIGHTING)\n#define OC_PORTABLE_ARMOR_ONLY\n#endif\n`;
    fs.writeFileSync(path.join(result,'core',`${kind}.vsh`), header.replace('#version 330','#version 330\n#extension GL_ARB_separate_shader_objects : require') + defines + globals + varying('out') + '\n#define OC_PORTABLE_VERTEX\n#include <minecraft:objmc_portable_carrier.glsl>\n#ifdef OC_PORTABLE_ARMOR_ONLY\n#include <minecraft:objmc_portable_armor-only-decode.glsl>\n#else\n#include <minecraft:objmc_portable_decode.glsl>\n#endif\n#ifdef ENTITY\n#include <minecraft:objmc_portable_armor-affine.glsl>\n#include <minecraft:objmc_portable_armor-bvh.glsl>\n#endif\n#ifdef OC_PORTABLE_ARMOR_ONLY\n#include <minecraft:objmc_portable_armor-only-vertex.glsl>\n#else\n#include <minecraft:objmc_portable_vertex.glsl>\n#endif\n' + body);
    let fragment = fsOriginal
      .replace(/^#version[^\n]*\n|^#extension[^\n]*\n/gm,'')
      .replace(/layout\(location = \d+\) (flat )?in [^;]+;\n/g,'')
      .replace('#include <minecraft:oit.glsl>','#include <minecraft:objmc_oit.glsl>')
      .replace('uniform sampler2D Sampler0;','')
      .replaceAll('texture(Sampler0, texCoord2)','oc_sample_model(texCoord2,true)')
      .replaceAll('texture(Sampler0, texCoord)','oc_sample_model(texCoord,false)')
      .replaceAll('texture(GlintSampler, texCoordGlint)','oc_sample_glint(texCoordGlint)')
      .replace('void main() {','void main() {\n    oc_init_fragment_depth();\n    oc_portable_fragment();');
    // Fragment UBOs and samplers are also needed by the original decoder.
    const fsHeader = header.replace(/layout\(location = \d+\) in [^;]+;\n/g,'')
      .replace('#version 330','#version 330\n#extension GL_ARB_separate_shader_objects : require');
    const split = fragment.indexOf('#ifndef OIT_ALPHA_ONLY\nvec4 calculateFinalColor');
    const before = fragment.slice(0,split), after=fragment.slice(split);
    const joined = fsHeader + defines + globals + varying('in') + before + '\n#include <minecraft:objmc_portable_carrier.glsl>\n#ifdef OC_PORTABLE_ARMOR_ONLY\n#include <minecraft:objmc_portable_armor-only-decode.glsl>\n#else\n#include <minecraft:objmc_portable_decode.glsl>\n#endif\n#ifdef ENTITY\n#include <minecraft:objmc_portable_armor-affine.glsl>\n#endif\n#ifndef OC_PORTABLE_ARMOR_ONLY\n#include <minecraft:objmc_portable_item-affine.glsl>\n#endif\n#include <minecraft:objmc_portable_bvh.glsl>\n#ifdef ENTITY\n#include <minecraft:objmc_portable_armor-bvh.glsl>\n#endif\n#include <minecraft:objmc_portable_armor-bounds.glsl>\n#include <minecraft:objmc_portable_armor-fast.glsl>\n#include <minecraft:objmc_portable_armor-early.glsl>\n#ifdef GLINT_SPECIAL\n#include <minecraft:objmc_portable_glint.glsl>\n#endif\n#ifdef OC_PORTABLE_ARMOR_ONLY\n#include <minecraft:objmc_portable_armor-only-fragment.glsl>\n#else\n#include <minecraft:objmc_portable_fragment.glsl>\n#endif\n' + after;
    // Vanilla terrainglobals has a misspelled include guard; avoid duplicate
    // direct imports instead of depending on guards or the offline resolver.
    const seen = new Set();
    fs.writeFileSync(path.join(result,'core',`${kind}.fsh`), joined.replace(/^#include <[^>]+>$/gm, line => { if (seen.has(line)) return ''; seen.add(line); return line; }));
  }
  const metadata=JSON.parse(fs.readFileSync(path.join(destination,'pack.mcmeta')));
  metadata.pack.description='[PORTABLE EXPERIMENTAL] obj³ 26.3 — no subgroup';
  fs.writeFileSync(path.join(destination,'pack.mcmeta'),JSON.stringify(metadata,null,2)+'\n');
  return destination;
  } catch(error) {
    fs.rmSync(destination,{recursive:true,force:true});
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(buildPortablePack(...process.argv.slice(2)));
