import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../objcubed/assets/minecraft/shaders/include/objmc_main.glsl', import.meta.url), 'utf8');
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, x, i) => sum + x*b[i], 0);
const neg = a => a.map(x => -x);
const rotate = (p, degrees) => {
  const [rx, ry, rz] = degrees.map(x => x*Math.PI/180);
  let [x, y, z] = p;
  [x, y] = [x*Math.cos(rz)-y*Math.sin(rz), x*Math.sin(rz)+y*Math.cos(rz)];
  [x, z] = [x*Math.cos(ry)+z*Math.sin(ry), -x*Math.sin(ry)+z*Math.cos(ry)];
  return [x, y*Math.cos(rx)-z*Math.sin(rx), y*Math.sin(rx)+z*Math.cos(rx)];
};

const paths = [
  { name: 'first person', depth: 'hdepth', matrix: 'hrot', x: 'huy', y: 'hux' },
  { name: 'world', depth: 'depthDirection', matrix: 'fullRotation', x: 'vPos2', y: 'vPos1' },
];

function shaderBasis(path, x, y, normal) {
  // Execute the actual production reconstruction tail, including its parity
  // branch, with vector operations supplied by the test harness.
  const match = source.match(new RegExp(`vec3 ${path.depth} = [\\s\\S]*?mat3 ${path.matrix} = [^;]+;`));
  expect(match, `production ${path.name} reconstruction`).not.toBeNull();
  const body = match[0].replace(/\b(?:vec3|mat3)\s+/g, 'let ')
    .replace(new RegExp(`-${path.depth}\\b`, 'g'), `neg(${path.depth})`);
  return new Function(path.x, path.y, 'Normal', 'cross', 'dot', 'neg', 'mat3',
    `${body}\nreturn ${path.matrix};`)(x, y, normal, cross, dot, neg, (...columns) => columns);
}

describe('carrier orientation preserves scale reflections', () => {
  it.each(paths)('$name preserves all eight reflection combinations under rotation', path => {
    for (const rotation of [[0,0,0], [23,-47,19], [0,90,0], [180,30,-88]]) {
      for (const sx of [-1,1]) for (const sy of [-1,1]) for (const sz of [-1,1]) {
        const x = rotate([sx,0,0], rotation), y = rotate([0,sy,0], rotation);
        // Vanilla's inverse-transpose normal carries reflection sign. Retain
        // the signed-byte quantization used for the vertex normal attribute.
        const normal = rotate([0,0,-sz], rotation).map(v => Math.round(v*127)/127);
        const actual = shaderBasis(path, x, y, normal);
        const expected = [x, y, rotate([0,0,sz], rotation)];
        expected.forEach((axis, i) => axis.forEach((v, j) => expect(actual[i][j]).toBeCloseTo(v, 12)));
      }
    }
  });

  it.each(paths)('$name keeps the existing basis when a normal is unavailable', path => {
    const x = rotate([1,0,0], [23,-47,19]), y = rotate([0,1,0], [23,-47,19]);
    const actual = shaderBasis(path, x, y, [0,0,0]);
    expect(actual).toEqual([x, y, cross(x,y)]);
  });
});
