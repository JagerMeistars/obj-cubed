#!/usr/bin/env node
// Add invisible carrier guards to ordinary item exports in a separate pack.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const GUARDS = 16;
const MANIFEST = 'OPENGL-MODELS.json';
const u24 = (b, i) => b[i] * 65536 + b[i + 1] * 256 + b[i + 2];
const vertexCount = b => b[8] * 16777216 + b[9] * 65536 + b[10] * 256 + b[29];
function files(root) {
  const result = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error(`Symlinked pack content: ${p}`);
      if (e.isDirectory()) walk(p); else result.push(p);
    }
  }
  walk(root);
  return result;
}
function nested(a, b) {
  const r = path.relative(a, b);
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
}
function texturePath(model, face, root) {
  let value = face.texture;
  const seen = new Set();
  while (typeof value === 'string' && value.startsWith('#')) {
    if (seen.has(value)) throw new Error('Cyclic model texture reference');
    seen.add(value); value = model.textures?.[value.slice(1)];
  }
  if (typeof value !== 'string') return null;
  const [namespace, name] = value.includes(':') ? value.split(':') : ['minecraft', value];
  if (!/^[a-z0-9_.-]+$/.test(namespace) || !/^[a-z0-9_./-]+$/.test(name) || name.split('/').includes('..')) return null;
  return path.join(root, 'assets', namespace, 'textures', `${name}.png`);
}
function layout(png) {
  const d = png.data, nv = vertexCount(d), nf = Math.max(u24(d, 12), 1);
  const width = d[4] * 256 + d[5];
  const frameHeight = d[6] * 256 + d[28];
  const textureFrames = Math.max(d[15], 1);
  const vp = d[20] * 256 + d[21], vt = d[22] * 256 + d[30];
  if (width !== png.width || nv <= 0 || nv % 4 || width < 16) throw new Error('Unsupported item texture layout');
  const faces = nv / 4, uvRows = Math.ceil(faces / width);
  const indexRow = 2 + uvRows + frameHeight * textureFrames + vp + vt;
  if ((indexRow * width + nf * nv * 2) * 4 > d.length) throw new Error('Truncated item vertex table');
  return { nv, nf, faces, width, uvRows, indexRow };
}
function prepareTexture(png) {
  const old = layout(png), width = old.width;
  const slots = [], emitted = [], originalToSlot = [];
  function add(original) {
    // Alpha is the low byte of the backpointer's row. Keep real and guard
    // carriers in one blended material even across the 255/256 row boundary.
    while ([0, 255].includes((2 + Math.floor(slots.length / width)) & 255)) slots.push(-1);
    const slot = slots.length;
    slots.push(original); emitted.push(slot);
    if (original >= 0) originalToSlot[original] = slot;
  }
  for (let i = 0; i < GUARDS; i++) add(-1);
  for (let i = 0; i < old.faces; i++) add(i);
  for (let i = 0; i < GUARDS; i++) add(-1);
  const nv = slots.length * 4, uvRows = Math.ceil(slots.length / width);
  const indexRow = old.indexRow + uvRows - old.uvRows;
  const height = Math.max(png.height, indexRow + Math.ceil(old.nf * nv * 2 / width));
  if (nv > 0x7fffffff || height > 16384) throw new Error(`Guarded item exceeds supported texture dimensions (${width}x${height})`);
  const out = new PNG({ width, height }); out.data.fill(0);
  png.data.copy(out.data, 0, 0, width * 2 * 4);
  out.data[8] = Math.floor(nv / 16777216); out.data[9] = nv >>> 16;
  out.data[10] = nv >>> 8; out.data[29] = nv;
  for (let i = 0; i < slots.length; i++) {
    const x = i % width, y = 2 + Math.floor(i / width), o = (y * width + x) * 4;
    out.data[o] = x >>> 8; out.data[o + 1] = x;
    out.data[o + 2] = y >>> 8; out.data[o + 3] = y;
  }
  png.data.copy(out.data, (2 + uvRows) * width * 4,
    (2 + old.uvRows) * width * 4, old.indexRow * width * 4);
  for (let frame = 0; frame < old.nf; frame++) {
    const first = (old.indexRow * width + frame * old.nv * 2) * 4;
    for (let face = 0; face < slots.length; face++) {
      const dest = (indexRow * width + (frame * nv + face * 4) * 2) * 4;
      const sourceFace = slots[face];
      if (sourceFace >= 0) png.data.copy(out.data, dest, first + sourceFace * 32, first + (sourceFace + 1) * 32);
      else for (let corner = 0; corner < 4; corner++) png.data.copy(out.data, dest + corner * 8, first, first + 8);
    }
  }
  return { old, png: out, emitted, originalToSlot, slots, indexRow };
}
function faceInfo(element, png, count) {
  if (Object.keys(element.faces ?? {}).join(',') !== 'north') throw new Error('Expected one NORTH carrier per element');
  const face = element.faces.north, uv = face.uv;
  if (!Array.isArray(uv) || uv.length !== 4 || face.rotation) throw new Error('Unsupported rotated or implicit carrier UV');
  const pixel = uv.map((v, i) => v * (i % 2 ? png.height : png.width) / 16);
  const x = Math.floor(pixel[0]), y = Math.floor(pixel[1]);
  if (Math.floor(pixel[2]) !== x || Math.floor(pixel[3]) !== y) throw new Error('Carrier UV crosses a marker texel');
  const id = (y - 2) * png.width + x;
  if (id < 0 || id >= count) throw new Error('Carrier UV is outside the face table');
  return { id, fractions: pixel.map((v, i) => v - (i % 2 ? y : x)) };
}
function rewriteElement(element, fractions, slot, png) {
  const result = structuredClone(element);
  const x = slot % png.width, y = 2 + Math.floor(slot / png.width);
  result.faces.north.uv = fractions.map((v, i) => ((i % 2 ? y : x) + v) * 16 / (i % 2 ? png.height : png.width));
  return result;
}

export function prepareOpenGLModels(input, output) {
  if (!input || !output) throw new Error('Usage: node tools/prepare-opengl-models.mjs <source-pack> <new-output-directory>');
  const source = fs.realpathSync(input), requested = path.resolve(output);
  const destination = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  if (nested(source, destination) || nested(destination, source)) throw new Error('Input/output must be separate, non-nested directories');
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite: ${destination}`);
  if (fs.existsSync(path.join(source, MANIFEST))) throw new Error('This pack already contains prepared OpenGL models');
  const all = files(source), textures = new Map(), plans = [];
  for (const file of all) {
    if (!file.endsWith('.json') || !file.includes(`${path.sep}models${path.sep}`)) continue;
    const model = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!model.elements?.length || !model.elements[0].faces?.north) continue;
    const texture = texturePath(model, model.elements[0].faces.north, source);
    if (!texture || !fs.existsSync(texture)) continue;
    let entry = textures.get(texture);
    if (!entry) {
      const png = PNG.sync.read(fs.readFileSync(texture));
      if (![12, 34, 56, 255].every((v, i) => png.data[i] === v)) continue;
      if (fs.existsSync(`${texture}.mcmeta`)) throw new Error(`Vanilla sprite animation is unsupported: ${texture}`);
      entry = { original: png, prepared: prepareTexture(png) }; textures.set(texture, entry);
    }
    const { original, prepared } = entry, count = prepared.old.faces;
    if (model.elements.length % count) throw new Error(`Incomplete carrier model: ${file}`);
    const replacement = [];
    for (let first = 0; first < model.elements.length; first += count) {
      const group = model.elements.slice(first, first + count);
      const infos = group.map((element, i) => {
        if (texturePath(model, element.faces?.north ?? {}, source) !== texture) throw new Error(`Mixed carrier textures: ${file}`);
        const info = faceInfo(element, original, count);
        if (info.id !== i) throw new Error(`Carrier emission order does not match the texture: ${file}`);
        const pose = ({ from, to, rotation }) => JSON.stringify({ from, to, rotation });
        if (pose(element) !== pose(group[0])) throw new Error(`Carrier pose varies within one encoded model: ${file}`);
        return info;
      });
      for (const slot of prepared.emitted) {
        const oldFace = prepared.slots[slot], i = oldFace < 0 ? 0 : oldFace;
        replacement.push(rewriteElement(group[i], infos[i].fractions, slot, prepared.png));
      }
    }
    model.elements = replacement;
    plans.push({ file, contents: JSON.stringify(model) + '\n', elements: replacement.length });
  }
  const report = {
    format: 1, guardsPerEnd: GUARDS,
    note: 'Item carriers only. Original geometry/UV payloads preserved; all emitted markers use a blended material. Armor textures are unchanged.',
    models: plans.map(p => ({ path: path.relative(source, p.file), elements: p.elements })),
    textures: [...textures].map(([file, e]) => ({ path: path.relative(source, file), originalFaces: e.prepared.old.faces, encodedFaces: e.prepared.slots.length, emittedFaces: e.prepared.emitted.length, frames: e.prepared.old.nf }))
  };
  try {
    fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    for (const p of plans) fs.writeFileSync(path.join(destination, path.relative(source, p.file)), p.contents);
    for (const [file, e] of textures) fs.writeFileSync(path.join(destination, path.relative(source, file)), PNG.sync.write(e.prepared.png));
    fs.writeFileSync(path.join(destination, MANIFEST), JSON.stringify(report, null, 2) + '\n');
  } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(prepareOpenGLModels(process.argv[2], process.argv[3]), null, 2));
}
