// Per-frame Y range of an obj³ animated PNG: decodes the vertex index table
// and reports min/max/mean Y of each frame's geometry.
// Usage: node tools/frame-heights.mjs anim.png
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const { width: tw, data: d } = png;
const px = (x, y) => { const i = (y * tw + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
const t = (i) => px(i, 0);
const sizeY = t(1)[2] * 256 + t(7)[0];
const nvertices = t(2)[0] * 16777216 + t(2)[1] * 65536 + t(2)[2] * 256 + t(7)[1];
const nframes = Math.max(t(3)[0] * 65536 + t(3)[1] * 256 + t(3)[2], 1);
const ntextures = Math.max(t(3)[3], 1);
const vph = t(5)[0] * 256 + t(5)[1];
const vth = t(5)[2] * 256 + t(7)[2];
const nfaces = nvertices / 4;
const uvH = Math.ceil(nfaces / tw);
const posBase = 2 + uvH + sizeY * ntextures;
const vertBase = posBase + vph + vth;
const b24 = ([r, g, b]) => r * 65536 + g * 256 + b;
const posAt = (idx) => {
  const p = idx * 3;
  const at = (k) => px((p + k) % tw, posBase + Math.floor((p + k) / tw));
  return [at(0), at(1), at(2)].map(c => (b24(c) - 8388608) / 65536);
};
const vertPosIdx = (id) => {
  const p = id * 2;
  return b24(px(p % tw, vertBase + Math.floor(p / tw)));
};
console.log(`nframes=${nframes} nvertices=${nvertices}`);
for (let f = 0; f < nframes; f++) {
  const ys = [];
  for (let v = 0; v < nvertices; v++) ys.push(posAt(vertPosIdx(f * nvertices + v))[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  console.log(`frame ${String(f).padStart(2)}: Y min ${min.toFixed(3)} max ${max.toFixed(3)} mean ${mean.toFixed(3)}`);
}
