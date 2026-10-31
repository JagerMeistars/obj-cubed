import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');
const { PNG } = require('pngjs');

function setup() {
  const width = 16, height = 16, rgba = new Uint8Array(width*height*4).fill(255);
  class Image {
    set src(_) { queueMicrotask(() => this.onload?.()); }
    get naturalWidth() { return width; }
    get naturalHeight() { return height; }
  }
  return loadObjcubedWithContext({ globals: {
    Buffer, Image, setTimeout, process,
    document: { createElement: () => ({ getContext: () => ({
      drawImage() {}, getImageData: () => ({ data: rgba, width, height }),
    }) }) },
    Texture: { all: [{ uuid: 'u', name: 'texture', source: 'data:fixture', img: { src: 'data:fixture' } }] },
    Outliner: { root: [] },
  } }).api;
}

const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl m_u\nf 1/1 2/2 3/3 4/4';
const cases = ['fixed', 'firstperson_righthand'].flatMap(slot => [
  { slot, scale: [.7,1.2,-.45], depth: .45 },
  { slot, scale: [1,1,-2], depth: 2 },
  { slot, scale: [-.7,1.2,.45], depth: .45 },
]);

describe('display depth metadata stores magnitude and keeps model reflection', () => {
  it.each(cases)('$slot $scale round-trips its depth magnitude through the exported PNG', async ({slot, scale, depth}) => {
    const api = setup();
    const cfg = {
      texIndex: 0, nopow: false, scale: 1, offset: [0,0,0],
      colorbehavior: ['direct','direct','direct'], duration: 0, autoplay: false,
      easing: 0, interpolation: 0, noshadow: true, autorotate: 0, visibility: 7,
      flipuv: false, useAtlas: false, texAnimEnabled: false, texFrametime: 1, texFade: false,
      displaySlots: { [slot]: { scale } },
    };
    const transforms = api.buildDisplayTransforms(cfg);
    expect(transforms[slot].scale).toEqual(scale);
    const { ids, dynamics } = api.assignSlotMarkers(transforms);
    const entry = dynamics.find(d => d.slot === slot);
    expect(entry?.sz).toBe(depth);
    const output = await api.buildOutput(cfg, [obj], '');
    const png = PNG.sync.read(output.pngBuffer);
    const id = ids.get(slot), bandCount = png.data[(png.width+5)*4+1];
    const x = id <= 4 ? id-1 : 6+2*bandCount+id-5;
    const pixel = (png.width+x)*4;
    const decoded = (png.data[pixel]*256+png.data[pixel+1])/65535*4;
    expect(decoded).toBeCloseTo(depth, 4);
    expect(png.data[pixel+3]).toBe(255);
    expect((png.data[pixel+2]&2)!==0).toBe(slot.startsWith('firstperson'));
  });

  it('does not add a depth override when reflected absolute scales use the measured fallback', () => {
    const api = setup();
    for (const scale of [[1,1,-1], [-1,1,1], [1,-1,1], [-1,-1,-1], [-.7,1.2,-.7]]) {
      const { ids, dynamics } = api.assignSlotMarkers({ fixed: { scale } });
      expect(ids.get('fixed')).toBe(0);
      expect(dynamics.some(d => d.slot === 'fixed')).toBe(false);
    }
  });
});
