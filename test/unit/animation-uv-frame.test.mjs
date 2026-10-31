import {describe, it, expect} from 'vitest';
import fs from 'node:fs';

// Execute the real decoder's interpolation block for one vector component.
// Frame 0 has an opaque UV/material; frame 1 points at transparent pixels.
// Position interpolation must never select frame 1's UV while frame 0 is active.
const source = fs.readFileSync(new URL('../../objcubed/assets/minecraft/shaders/include/objmc_main.glsl', import.meta.url), 'utf8');
const start = source.indexOf('        if (nframes > 1) {');
const end = source.indexOf('        transition = 0;', start);
const block = source.slice(start, end).replace(/\b(?:vec3|ivec2|int|float)\s+/g, 'let ');
const run = new Function('easing', 'animationPhase', 'frame', `
  let nframes=2,nvertices=4,id=frame*4,index={x:frame,y:frame},posoffset=frame;
  let topleft=0,size={x:32},height=0,vph=0,vth=0,transition=0;
  const getvert=(_o,_w,_r,i)=>({x:Math.floor(i/4),y:Math.floor(i/4)});
  const getpos=(_o,_w,_r,i)=>i;
  const fract=x=>x-Math.floor(x);
  const mix=(a,b,t)=>a*(1-t)+b*t, ease=(_m,t)=>t;
  const bezier=(a,b,c,d,t)=>mix(b,c,t);
  ${block}
  return {id,index};
`);

describe('UV and profile material belong to the selected geometry frame', () => {
  for (const mode of [0,1,2,3,4,5]) it(`keeps current UV through easing mode ${mode}`, () => {
    for (const frame of [0,1]) for (const partial of [0,.25,.99]) {
      const decoded=run(mode,frame+partial,frame);
      expect(decoded.index.y,`frame ${frame}, partial ${partial}`).toBe(frame);
      expect(decoded.id).toBe(frame*4); // atlas-band lookup also needs the current frame
    }
  });
});
