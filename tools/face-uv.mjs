// Per-face UV rects (atlas rows) of an obj³ PNG — frame 0 vertices.
// Usage: node tools/face-uv.mjs file.png
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');
const p = PNG.sync.read(fs.readFileSync(process.argv[2]));
const tw = p.width, d = p.data;
const px = (x, y) => { const i = (y * tw + x) * 4; return [d[i], d[i+1], d[i+2], d[i+3]]; };
const t = (i) => px(i, 0);
const sizeY = t(1)[2]*256 + t(7)[0];
const nv = t(2)[0]*16777216 + t(2)[1]*65536 + t(2)[2]*256 + t(7)[1];
const nt = Math.max(t(3)[3], 1);
const vph = t(5)[0]*256 + t(5)[1];
const vth = t(5)[2]*256 + t(7)[2];
const uvH = Math.ceil(nv/4/tw);
const posBase = 2 + uvH + sizeY*nt;
const uvBase = posBase + vph;
const vertBase = uvBase + vth;
const b24 = (c) => c[0]*65536 + c[1]*256 + c[2];
const uvAt = (idx) => {
  const q = idx*2;
  const at = (k) => px((q+k)%tw, uvBase + Math.floor((q+k)/tw));
  return [b24(at(0))/65535, b24(at(1))/65535];
};
const vertUvIdx = (id) => b24(px((id*2+1)%tw, vertBase + Math.floor((id*2+1)/tw)));
const nfaces = nv/4;
console.log(`atlasH=${sizeY} nfaces=${nfaces}`);
for (let f = 0; f < nfaces; f++) {
  const us = [], vs = [];
  for (let c = 0; c < 4; c++) {
    const [u, v] = uvAt(vertUvIdx(f*4 + c));
    us.push(u*tw); vs.push(v*sizeY);
  }
  const vmin = Math.min(...vs), vmax = Math.max(...vs);
  const vmid = (Math.min(...vs) + Math.max(...vs)) / 2;
  console.log(`face ${String(f).padStart(2)}: U ${Math.min(...us).toFixed(1)}..${Math.max(...us).toFixed(1)}  V ${vmin.toFixed(1)}..${vmax.toFixed(1)}  (vmid ${vmid.toFixed(1)})`);
}
