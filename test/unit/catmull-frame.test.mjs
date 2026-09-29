import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const include = name => fs.readFileSync(new URL(`../../objcubed/assets/minecraft/shaders/include/${name}`, import.meta.url), 'utf8');
const tools = include('objmc_tools.glsl');
const body = name => tools.match(new RegExp(`vec3 ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\}`))[1].replace(/float /g, 'const ');
// Execute the production helper for one vector component, not a copied formula.
const bezb = new Function('a', 'b', 'c', 'd', 't', body('bezb'));
const bezier = new Function('bezb', 'a', 'b', 'c', 'd', 't', body('bezier')).bind(null, bezb);
const paths = [
  ['item', 'objmc_main.glsl', 'easing', 'posoffset'],
  ['armor', 'objmc_main.glsl', 'aeasing', 'posoffset'],
  ['animal v1', 'objmc_animal.glsl', 'ocAnimalEasing', 'ocAnimalDecoded'],
  ['animal v2', 'objmc_animal_v2.glsl', 'ocAnimalEasing', 'ocAnimalDecoded'],
];

describe('Catmull-Rom starts at the selected frame in every decoder', () => {
  it.each(paths)('%s uses previous/current/next/next-next, including loop boundaries',
    (_name, file, mode, result) => {
      const source = include(file);
      const block = source.match(new RegExp(`if \\(${mode} == 3\\) \\{([\\s\\S]*?)\\n\\s*\\} else`))[1]
        .replace(/\b(?:vec3|ivec2|int|float)\s+/g, 'let ');
      for (const count of [2, 3, 4, 5]) {
        const frames = [0, 8, -4, 13, 3].slice(0, count);
        for (let frame = 0; frame < count; frame++) for (const t of [0, 0.25, 1]) {
          const next = frames[(frame + 1) % count], current = frames[frame];
          const scope = {
            bezier, ivec2: value => value,
            getvert: (_origin, _width, _row, id) => ({ x: Math.floor(id / 4), y: id }),
            getpos: (_origin, _width, _row, index) => frames[index],
            topleft: 0, size: { x: 32 }, height: 0, vph: 0, vth: 0,
            id: ((frame + 1) % count) * 4, currentId: frame * 4,
            index: { x: frame, y: frame * 4 }, currentIndex: { x: frame, y: frame * 4 }, nvertices: 4, nids: count * 4,
            posoffset: current, posoffset2: next, transition: t,
            ao: 0, as: { x: 32 }, ah: 0, avph: 0, avth: 0, avbase: 0,
            afr: frame, anf: count, anv: 4, po2: next, atr: t,
            ocAnimalSize: { x: 32 }, ocAnimalGeometryRow: 0, ocAnimalVertexRow: 0,
            ocAnimalBaseVertex: 0, ocAnimalFrame: frame, ocAnimalFrames: count,
            ocAnimalVertices: 4, ocAnimalDecoded: current, next, blend: t,
          };
          const decoded = new Function(...Object.keys(scope), block + `\nreturn {value:${result},id,index};`)(...Object.values(scope));
          const actual = decoded.value;
          if (_name === 'item') {
            expect(decoded.id).toBe(frame * 4);
            expect(decoded.index.y).toBe(frame * 4); // UVs belong to the selected frame too
          }
          // Independent Hermite endpoint/tangent contract for the current segment.
          const before = frames[(frame + count - 1) % count], after = frames[(frame + 2) % count];
          const expected = (2*t**3-3*t**2+1)*current + (t**3-2*t**2+t)*(next-before)/2
            + (-2*t**3+3*t**2)*next + (t**3-t**2)*(after-current)/2;
          expect(actual, `frame ${frame}/${count}, blend ${t}`).toBeCloseTo(expected, 10);
        }
      }
    });
});
