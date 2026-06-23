// Issue #8: datapack function layout.
// PUBLIC funcs live at data/<ns>/function/<id>/<func>.mcfunction; INTERNAL
// helpers (_apply_auto/_apply_manual) move under .../<id>/zzz/. No path uses
// the old 'animations/' segment, and every 'function <ns>:<p>' call must
// resolve to a generated file (referential closure).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();

describe('datapack function layout (#8)', () => {
  it('emits public funcs at <id>/ and internals at <id>/zzz/, no animations/ segment', () => {
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'equipment', 'mainhand');
    const keys = [...files.keys()];

    for (const name of ['init', 'play', 'stop', 'set', 'play_from', 'play_once']) {
      expect(keys, name).toContain(`data/objcubed/function/walk/${name}.mcfunction`);
    }
    for (const name of ['_apply_auto', '_apply_manual']) {
      expect(keys, name).toContain(`data/objcubed/function/walk/zzz/${name}.mcfunction`);
    }
    expect(keys).toContain('pack.mcmeta');

    for (const k of keys) {
      expect(k, k).not.toMatch(/animations\//);
    }
  });

  it('player target keeps both _apply branches under zzz/', () => {
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'player', 'mainhand');
    const keys = [...files.keys()];
    expect(keys).toContain('data/objcubed/function/walk/zzz/_apply_auto.mcfunction');
    expect(keys).toContain('data/objcubed/function/walk/zzz/_apply_manual.mcfunction');
    for (const k of keys) expect(k, k).not.toMatch(/animations\//);
  });

  // Referential closure: every internal `function objcubed:<p>` reference in any
  // file body must point at a generated key. Run for both target branches.
  for (const target of ['equipment', 'player']) {
    it(`referential closure holds for target=${target}`, () => {
      const files = api.generateDatapackFiles('walk', 5, 'objcubed', target, 'mainhand');
      const keys = new Set([...files.keys()]);
      const re = /function\s+objcubed:(\S+)/g;
      let found = 0;
      for (const body of files.values()) {
        let m;
        while ((m = re.exec(body)) !== null) {
          found++;
          const key = `data/objcubed/function/${m[1]}.mcfunction`;
          expect(keys.has(key), `${m[1]} -> ${key}`).toBe(true);
        }
      }
      expect(found).toBeGreaterThan(0);
    });
  }
});

describe('datapack correctness (review batch 2)', () => {
  it('sanitizes namespace + animId to valid resource-location chars', () => {
    const files = api.generateDatapackFiles('Walk Cycle!', 5, 'My Pack', 'equipment', 'mainhand');
    const keys = [...files.keys()];
    expect(keys).toContain('data/my_pack/function/walk_cycle_/play.mcfunction');
    // No uppercase / space / punctuation leaks into any path…
    for (const k of keys) expect(k, k).not.toMatch(/[^a-z0-9_./-]/);
    // …nor into any `function <ns>:<id>/…` reference in the bodies.
    for (const body of files.values()) {
      let m; const re = /function\s+(\S+)/g;
      while ((m = re.exec(body)) !== null) expect(m[1], m[1]).not.toMatch(/[A-Z !]/);
    }
  });

  it('pack.mcmeta has a valid (min<=max) format range + pack_format', () => {
    const meta = JSON.parse(
      api.generateDatapackFiles('walk', 5, 'objcubed', 'equipment', 'mainhand').get('pack.mcmeta'));
    expect(typeof meta.pack.pack_format).toBe('number');
    expect(typeof meta.pack.min_format).toBe('number');
    expect(typeof meta.pack.max_format).toBe('number');
    expect(meta.pack.min_format).toBeLessThanOrEqual(meta.pack.max_format);
  });

  it('play restarts at frame 0 (no stale-offset resume); play_from still uses @s', () => {
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'equipment', 'mainhand');
    const play = files.get('data/objcubed/function/walk/play.mcfunction');
    expect(play).not.toMatch(/-= @s/);   // no stale-offset subtraction
    expect(play).toMatch(/%= #dur/);     // phase = gametime % dur -> frame 0 now
    expect(files.get('data/objcubed/function/walk/play_from.mcfunction')).toMatch(/-= @s/);
  });

  it('play_once emits a tick latch that freezes after nframes ticks', () => {
    const files = api.generateDatapackFiles('walk', 10, 'mypack', 'equipment', 'mainhand');
    // play_once stores an absolute deadline = gametime + nframes in objective <id>.end
    const playOnce = files.get('data/mypack/function/walk/play_once.mcfunction');
    expect(playOnce).toMatch(/execute store result score @s walk\.end run time query gametime/);
    expect(playOnce).toMatch(/scoreboard players add @s walk\.end 10/); // + nframes
    // init registers the new objective
    const init = files.get('data/mypack/function/walk/init.mcfunction');
    expect(init).toMatch(/scoreboard objectives add walk\.end dummy/);
    // a minecraft:tick tag drives the per-entity check
    expect(files.has('data/minecraft/tags/function/tick.json')).toBe(true);
    const tickTag = JSON.parse(files.get('data/minecraft/tags/function/tick.json'));
    expect(tickTag.values).toContain('mypack:walk/tick');
    expect(files.has('data/mypack/function/walk/zzz/_latch_once.mcfunction')).toBe(true);
    const latch = files.get('data/mypack/function/walk/zzz/_latch_once.mcfunction');
    expect(latch).toMatch(/scoreboard players set @s walk 9/);          // last frame = nframes-1
    expect(latch).toMatch(/tag @s remove walk\.once/);
    // referential closure: tick.mcfunction and _check_once must exist
    expect(files.has('data/mypack/function/walk/tick.mcfunction')).toBe(true);
    expect(files.has('data/mypack/function/walk/zzz/_check_once.mcfunction')).toBe(true);
  });
});
