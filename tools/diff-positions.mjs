// Diff the baked vertex POSITIONS of two obj³ data PNGs (e.g. a static export
// vs an animated export of the same model). Positions are deduplicated in
// first-seen order, so if animated frame 0 matches the static geometry, the
// first N positions of both files are identical.
// Usage: node tools/diff-positions.mjs static.png anim.png
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

function decode(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width: tw, height: ty, data: d } = png;
  const px = (x, y) => { const i = (y * tw + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const t = (i) => px(i, 0);
  if (String(t(0).slice(0, 3)) !== '12,34,56') throw new Error(`${file}: no obj3 marker`);
  const sizeY = t(1)[2] * 256 + t(7)[0];
  const nvertices = t(2)[0] * 16777216 + t(2)[1] * 65536 + t(2)[2] * 256 + t(7)[1];
  const nframes = Math.max(t(3)[0] * 65536 + t(3)[1] * 256 + t(3)[2], 1);
  const ntextures = Math.max(t(3)[3], 1);
  const vph = t(5)[0] * 256 + t(5)[1];
  const nfaces = nvertices / 4;
  const uvH = Math.ceil(nfaces / tw);
  const ybase = 2 + uvH + sizeY * ntextures; // header + uv rows + texture block
  const b24 = ([r, g, b]) => (r * 65536 + g * 256 + b - 8388608) / 65536;
  const pos = [];
  for (let p = 0; p < vph * tw; p += 3) {
    const at = (k) => px((p + k) % tw, ybase + Math.floor((p + k) / tw));
    const P = [at(0), at(1), at(2)];
    if (P.every(c => c[3] === 0)) break; // ran past the data into blank pixels
    pos.push(P.map(b24));
  }
  return { tw, ty, nframes, nvertices, pos };
}

const [a, b] = process.argv.slice(2);
const A = decode(a), B = decode(b);
console.log(`${a}: ${A.tw}x${A.ty} nframes=${A.nframes} nvertices=${A.nvertices} positions=${A.pos.length}`);
console.log(`${b}: ${B.tw}x${B.ty} nframes=${B.nframes} nvertices=${B.nvertices} positions=${B.pos.length}`);
const n = Math.min(A.pos.length, B.pos.length);
const dy = [];
for (let i = 0; i < n; i++) dy.push(B.pos[i][1] - A.pos[i][1]);
const stats = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return { min: s[0], max: s[s.length - 1], median: s[Math.floor(s.length / 2)] };
};
console.log(`\nY diff over first ${n} shared positions (anim - static), blocks:`);
console.log(stats(dy));
const dx = stats(A.pos.slice(0, n).map((p, i) => B.pos[i][0] - p[0]));
const dz = stats(A.pos.slice(0, n).map((p, i) => B.pos[i][2] - p[2]));
console.log('X diff:', dx, '\nZ diff:', dz);
console.log('\nfirst 5 static Y:', A.pos.slice(0, 5).map(p => p[1].toFixed(4)).join(', '));
console.log('first 5 anim   Y:', B.pos.slice(0, 5).map(p => p[1].toFixed(4)).join(', '));
