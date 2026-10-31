// Export regression: keep the terminal pose for manual/once playback, but do
// not allocate it a second time interval in a closed autoplay loop.
import {describe, it, expect} from 'vitest';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {loadColorPlugin} = require('../helpers/color-plugin.cjs');
const {PNG} = require('pngjs');

const obj = (x, u = 0) => [
  `v ${x} 0 0`, `v ${x+1} 0 0`, `v ${x+1} 1 0`, `v ${x} 1 0`,
  `vt ${u} 0`, 'vt 1 0', 'vt 1 1', 'vt 0 1',
  'usemtl m_u', 'f 1/1 2/2 3/3 4/4',
].join('\n');
const cfg = {texIndex:0, scale:1, offset:[0,0,0],
  colorbehavior:['direct','direct','direct'], duration:4, autoplay:true,
  easing:1, interpolation:0, noshadow:false, autorotate:3, visibility:7,
  displaySlots:{}, useAtlas:false};
async function exported(frames, extra = {}) {
  const {api} = loadColorPlugin();
  const result = await api.buildOutput({...cfg, ...extra}, frames, '');
  const png = PNG.sync.read(Buffer.from(result.pngBuffer));
  const pixel = (x, y) => [...png.data.subarray((y*png.width+x)*4, (y*png.width+x+1)*4)];
  const rgb = p => p[0]*65536+p[1]*256+p[2];
  return {result, pixel, frames:rgb(pixel(3,0)), duration:rgb(pixel(4,0)),
    closed:pixel(5,1)[2]>=2 && !!(pixel(0,1)[2]&4)};
}

describe('closed autoplay loops', () => {
  it('retains all endpoint samples while marking the repeated terminal pose', async () => {
    const out = await exported([0,1,2,1,0].map(x => obj(x)));
    expect(out.closed).toBe(true);
    expect(out.frames).toBe(5);
    expect(out.result.nframes).toBe(5);
    expect(out.duration).toBe(4);
    expect(out.pixel(0,1)[3]).toBe(255);
  });
  it('preserves the legacy default duration for manual control of an autoplay export', async () => {
    const out = await exported([0,1,2,1,0].map(x => obj(x)), {duration:0});
    expect(out.closed).toBe(true);
    expect(out.duration).toBe(5); // one tick per stored frame in manual mode
  });
  it.each([
    ['different final pose', [0,1,2,1,0.1].map(x => obj(x))],
    ['different final UV', [obj(0),obj(1),obj(0,.25)]],
    ['single frame', [obj(0)]],
  ])('preserves the existing cycle for %s', async (_name, frames) => {
    const out = await exported(frames, {duration:0});
    expect(out.closed).toBe(false);
    expect(out.frames).toBe(frames.length);
    expect(out.duration).toBe(frames.length);
  });
  it('compares the stored precision, allowing subpixel endpoint roundoff', async () => {
    expect((await exported([obj(0),obj(1),obj(0.000001)])).closed).toBe(true);
  });
  it('does not change the datapack/manual frame range or duration', async () => {
    const out = await exported([0,1,2,1,0].map(x => obj(x)), {
      autoplay:false, duration:0, generateDatapack:true, colorbehavior:['time','time','time'],
    });
    expect(out.closed).toBe(false);
    expect(out.frames).toBe(5);
    expect(out.duration).toBe(5);
  });
  it('coexists with the first-person context marker in the same pixel', async () => {
    const out = await exported([obj(0),obj(1),obj(0)], {
      displaySlots:{firstperson_righthand:{scale:[1,1,.5]}},
    });
    expect(out.closed).toBe(true);
    expect(out.pixel(0,1)[2]&2).toBe(2);
  });
});
