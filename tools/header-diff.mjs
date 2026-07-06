import fs from 'node:fs';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');
const load = f => PNG.sync.read(fs.readFileSync(f));
const [A, B] = process.argv.slice(2).map(load);
const px = (p, x, y) => { const i = (y * p.width + x) * 4; return [p.data[i], p.data[i+1], p.data[i+2], p.data[i+3]]; };
for (const row of [0, 1]) {
  for (let x = 0; x < 24; x++) {
    const a = px(A, x, row), b = px(B, x, row);
    if (String(a) !== String(b)) console.log(`row ${row} x=${x}: static [${a}]  anim [${b}]`);
  }
}
console.log('done');
