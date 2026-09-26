import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {afterEach, describe, expect, it} from 'vitest';

import {prepareOpenGLModels} from '../../tools/prepare-opengl-models.mjs';

const dirs = [], textureFile = 'assets/oracle/textures/item/model.png',
      modelFile = 'assets/oracle/models/item/model.json',
      slotFile = 'assets/oracle/models/item/hand.json';
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, {recursive : true, force : true});
});
function temp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obj3-gl-models-'));
  dirs.push(root);
  return root;
}
function put24(d, p, n) {
  d.set([ (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255 ], p * 4);
}
function read24(d, p) {
  return d[p * 4] * 65536 + d[p * 4 + 1] * 256 + d[p * 4 + 2];
}
function layout(png) {
  const d = png.data, nv = d[8] * 16777216 + d[9] * 65536 + d[10] * 256 + d[29],
        faces = nv / 4, frames = read24(d, 3),
        header = 2 + Math.ceil(faces / png.width),
        positions = header + (d[6] * 256 + d[28]) * d[15],
        uvs = positions + d[20] * 256 + d[21],
        index = uvs + d[22] * 256 + d[30];
  return {nv, faces, frames, header, positions, uvs, index};
}
function fixture(root,
                 {faces = 7, instances = 1, slot = true, armor = false} = {}) {
  const source = path.join(root, 'source');
  for (const file of [textureFile, modelFile])
    fs.mkdirSync(path.dirname(path.join(source, file)), {recursive : true});
  const width = 16, frames = 2, nv = faces * 4,
        index = 2 + Math.ceil(faces / width) + 6 + 9 + 7,
        png = new PNG(
            {width, height : index + Math.ceil(frames * nv * 2 / width) + 3}),
        d = png.data;
  for (let i = 0; i < d.length; i++)
    d[i] = (i * 73 + Math.floor(i / 61) * 19 + 11) & 255;
  d.set([ 12, 34, 56, armor ? 253 : 255 ]);
  d[4] = 0;
  d[5] = width;
  d[6] = 0;
  d[28] = 2;
  d[8] = Math.floor(nv / 16777216);
  d[9] = nv >>> 16;
  d[10] = nv >>> 8;
  d[29] = nv;
  put24(d, 3, frames);
  d[15] = 3;
  d[20] = 0;
  d[21] = 9;
  d[22] = 0;
  d[30] = 7;
  const m = layout(png);
  for (let f = 0; f < faces; f++) {
    const x = f % width, y = 2 + Math.floor(f / width);
    d.set([ x >>> 8, x & 255, y >>> 8, y & 255 ], (y * width + x) * 4);
  }
  for (let p = 0; p < 47; p++)
    for (let a = 0; a < 3; a++)
      put24(d, m.positions * width + p * 3 + a,
            8388608 + p * 1709 + a * 731 - 30000);
  for (let u = 0; u < 53; u++)
    for (let a = 0; a < 2; a++)
      put24(d, m.uvs * width + u * 2 + a, (u * 947 + a * 607) & 65535);
  for (let f = 0; f < frames; f++)
    for (let v = 0; v < nv; v++) {
      const p = m.index * width + (f * nv + v) * 2;
      put24(d, p, (f * 11 + v) % 47);
      put24(d, p + 1, (f * 17 + v * 13) % 53);
    }
  const model = {
    textures : {image : 'oracle:item/model', '0' : '#image'},
    ambientocclusion : false,
    display : {fixed : {rotation : [ 12, -33, 4 ], scale : [ .5, 1, 2 ]}},
    elements : []
  };
  for (let k = 0; k < instances; k++)
    for (let f = 0; f < faces; f++) {
      const x = f % width, y = 2 + Math.floor(f / width);
      model.elements.push({
        from : [ 8 + k, 8, 8 ],
        to : [ 24 + k, 24, 8 ],
        shade : f % 2 === 0,
        light_emission : f % 16,
        faces : {
          north : {
            texture : '#0',
            tintindex : f % 3,
            uv : [ x + .1, y + .1, x + .9, y + .9 ].map(
                (v, i) => v * 16 / (i % 2 ? png.height : width))
          }
        }
      });
    }
  fs.writeFileSync(path.join(source, textureFile), PNG.sync.write(png));
  fs.writeFileSync(path.join(source, modelFile), JSON.stringify(model));
  fs.writeFileSync(path.join(source, 'pack.mcmeta'), '{}');
  let hand;
  if (slot) {
    hand = structuredClone(model);
    hand.display = {firstperson_righthand : {rotation : [ 5, 23, -12 ]}};
    for (const e of hand.elements) {
      const u = e.faces.north.uv, x = Math.floor(u[0] * width / 16);
      u[0] = (x + .405) * 16 / width;
      u[2] = (x + .805) * 16 / width;
    }
    fs.writeFileSync(path.join(source, slotFile), JSON.stringify(hand));
  }
  return {source, png, model, hand, instances};
}
function faceInfo(element, png) {
  const p = element.faces.north.uv.map(
            (v, i) => v * (i % 2 ? png.height : png.width) / 16),
        x = Math.floor((p[0] + p[2]) * .5), y = Math.floor((p[1] + p[3]) * .5),
        o = (y * png.width + x) * 4, d = png.data;
  expect([ d[o] * 256 + d[o + 1], d[o + 2] * 256 + d[o + 3] ]).toEqual([
    x, y
  ]);
  return {
    id : (y - 2) * png.width + x,
    row : y,
    fractions : p.map((v, i) => v - (i % 2 ? y : x))
  };
}
function vertex(png, m, frame, face, corner) {
  const p = m.index * png.width + (frame * m.nv + face * 4 + corner) * 2,
        pi = read24(png.data, p), ui = read24(png.data, p + 1);
  return {
    pair : png.data.subarray(p * 4, p * 4 + 8),
    position : png.data.subarray((m.positions * png.width + pi * 3) * 4,
                                 (m.positions * png.width + pi * 3 + 3) * 4),
    uv : png.data.subarray((m.uvs * png.width + ui * 2) * 4,
                           (m.uvs * png.width + ui * 2 + 2) * 4)
  };
}
describe('OpenGL item carrier guards', () => {
  it('preserves every animated vertex, pools and slot properties across skipped alpha rows',
     () => {
       const root = temp(),
             f = fixture(root, {faces : 16 * 254 + 5, instances : 2}),
             dest = path.join(root, 'prepared'),
             originals = new Map([ textureFile, modelFile, slotFile ].map(
                 p => [p, fs.readFileSync(path.join(f.source, p))]));
       const report = prepareOpenGLModels(f.source, dest),
             out = PNG.sync.read(fs.readFileSync(path.join(dest, textureFile))),
             a = layout(f.png), b = layout(out);
       expect(report.textures).toHaveLength(1);
       expect(report.models).toHaveLength(2);
       expect(report.guardsPerEnd).toBe(16);
       expect(b.frames).toBe(2);
       expect(report.textures[0].emittedFaces).toBe(a.faces + 32);
       expect(b.faces).toBe(a.faces + 64);
       for (let i = 0; i < f.png.width * 2 * 4; i++)
         if (![8, 9, 10, 29].includes(i))
           expect(out.data[i]).toBe(f.png.data[i]);
       expect(
           out.data.subarray(b.header * out.width * 4, b.index * out.width * 4))
           .toEqual(f.png.data.subarray(a.header * out.width * 4,
                                        a.index * out.width * 4));
       const model =
           JSON.parse(fs.readFileSync(path.join(dest, modelFile), 'utf8'));
       expect(model.display).toEqual(f.model.display);
       expect(model.textures).toEqual(f.model.textures);
       expect(model.elements).toHaveLength(f.instances * (a.faces + 32));
       const slots =
           model.elements.slice(0, a.faces + 32).map(e => faceInfo(e, out));
       expect(slots.every(({row}) => (row & 255) !== 0 && (row & 255) !== 255))
           .toBe(true);
       expect(slots.some(({row}) => row === 254)).toBe(true);
       expect(slots.some(({row}) => row === 257)).toBe(true);
       for (let frame = 0; frame < 2; frame++)
         for (let face = 0; face < a.faces; face++)
           for (let c = 0; c < 4; c++) {
             const current = vertex(out, b, frame, slots[16 + face].id, c),
                   previous = vertex(f.png, a, frame, face, c);
             for (const key of ['pair', 'position', 'uv'])
               if (!current[key].equals(previous[key]))
                 throw new Error(`${key} changed at frame ${frame}, face ${
                     face}, corner ${c}`);
           }
       for (let frame = 0; frame < 2; frame++)
         for (const slot of [...slots.slice(0, 16), ...slots.slice(-16)])
           for (let c = 1; c < 4; c++)
             expect(vertex(out, b, frame, slot.id, c))
                 .toEqual(vertex(out, b, frame, slot.id, 0));
       for (let k = 0; k < f.instances; k++)
         for (let face = 0; face < a.faces; face++) {
           const old = f.model.elements[k * a.faces + face],
                 next = structuredClone(
                     model.elements[k * (a.faces + 32) + 16 + face]);
           next.faces.north.uv = old.faces.north.uv;
           assert.deepStrictEqual(next, old);
         }
       const hand =
           JSON.parse(fs.readFileSync(path.join(dest, slotFile), 'utf8'));
       expect(hand.display).toEqual(f.hand.display);
       for (const i of [0, 15, 16, 16 + a.faces - 1, a.faces + 31]) {
         const frac = faceInfo(hand.elements[i], out).fractions;
         expect(frac[0]).toBeCloseTo(.405, 9);
         expect(frac[2]).toBeCloseTo(.805, 9);
         expect(frac[1]).toBeCloseTo(.1, 9);
         expect(frac[3]).toBeCloseTo(.9, 9);
       }
       for (const [file, bytes] of originals)
         expect(fs.readFileSync(path.join(f.source, file)).equals(bytes))
             .toBe(true);
     },
     20000);
  it('refuses overwrite, nested outputs and double preparation without mutations',
     () => {
       const root = temp(), f = fixture(root),
             dest = path.join(root, 'prepared');
       prepareOpenGLModels(f.source, dest);
       const bytes = fs.readFileSync(path.join(dest, textureFile));
       expect(() => prepareOpenGLModels(f.source, dest)).toThrow(/overwrite/);
       expect(() => prepareOpenGLModels(dest, path.join(root, 'twice')))
           .toThrow(/already contains/);
       expect(fs.existsSync(path.join(root, 'twice'))).toBe(false);
       expect(fs.readFileSync(path.join(dest, textureFile))).toEqual(bytes);
       expect(() =>
                  prepareOpenGLModels(f.source, path.join(f.source, 'nested')))
           .toThrow(/non-nested/);
     });
  it('leaves armor textures and models byte-identical', () => {
    const root = temp(), f = fixture(root, {armor : true}),
          dest = path.join(root, 'prepared'),
          r = prepareOpenGLModels(f.source, dest);
    expect(r.textures).toHaveLength(0);
    expect(r.models).toHaveLength(0);
    for (const p of [textureFile, modelFile, slotFile])
      expect(fs.readFileSync(path.join(dest, p)))
          .toEqual(fs.readFileSync(path.join(f.source, p)));
  });
  it.each([ 'order', 'pose', 'incomplete', 'texture-animation' ])(
      'rejects unsupported %s before output exists', kind => {
        const root = temp(), f = fixture(root, {slot : false}),
              dest = path.join(root, 'prepared');
        if (kind === 'order')
          [f.model.elements[0], f.model.elements[1]] =
              [ f.model.elements[1], f.model.elements[0] ];
        if (kind === 'pose')
          f.model.elements[1].from[0]++;
        if (kind === 'incomplete')
          f.model.elements.pop();
        if (kind === 'texture-animation')
          fs.writeFileSync(path.join(f.source, textureFile + '.mcmeta'), '{}');
        fs.writeFileSync(path.join(f.source, modelFile),
                         JSON.stringify(f.model));
        expect(() => prepareOpenGLModels(f.source, dest)).toThrow();
        expect(fs.existsSync(dest)).toBe(false);
      });
});
