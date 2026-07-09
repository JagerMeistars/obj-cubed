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
    // No uppercase / space / punctuation leaks into any resource-location path…
    // (fixed root literals like README.txt aren't derived from user input).
    for (const k of keys) {
      if (k.startsWith('data/')) expect(k, k).not.toMatch(/[^a-z0-9_./-]/);
    }
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

  it('emits a summon function, load tag, and README (issue #9)', () => {
    const files = api.generateDatapackFiles('walk', 8, 'mypack', 'item_display', null, 'stick', 'mymodel');
    const summon = files.get('data/mypack/function/walk/summon.mcfunction');
    expect(summon).toMatch(/summon item_display/);
    expect(summon).toMatch(/"minecraft:custom_model_data":\{strings:\["mymodel"\]\}/);
    expect(summon).toMatch(/Tags:\["mypack\.walk"\]/);
    const load = JSON.parse(files.get('data/minecraft/tags/function/load.json'));
    expect(load.values).toContain('mypack:walk/init');
    expect(files.has('README.txt')).toBe(true);
  });

  it('player temp armor_stand is isolated per-run (at @s + per-id tag + tight distance) (A5)', () => {
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'player', 'mainhand');
    const auto = files.get('data/objcubed/function/walk/zzz/_apply_auto.mcfunction');
    const manual = files.get('data/objcubed/function/walk/zzz/_apply_manual.mcfunction');
    for (const [name, body] of [['_apply_auto', auto], ['_apply_manual', manual]]) {
      // summon at the player, not the command origin
      expect(body, name).toMatch(/execute at @s run summon armor_stand ~ ~ ~ /);
      // per-animation tag (objcubed_temp_walk), with Marker so it has no collision
      expect(body, name).toMatch(/Tags:\["objcubed_temp_walk"\]/);
      expect(body, name).toMatch(/Marker:1b/);
      // selector is per-id tag + tight distance, relative to @s
      expect(body, name).toMatch(/@e\[tag=objcubed_temp_walk,distance=\.\.0\.01,limit=1,sort=nearest\]/);
      // the OLD bare shared-tag form is gone
      expect(body, name).not.toMatch(/Tags:\["objcubed_temp"\]/);
      expect(body, name).not.toMatch(/tag=objcubed_temp,limit=1,sort=nearest\]/);
    }
  });

  it('equipment summon spawns the armor_stand ALREADY equipped (A4)', () => {
    // Armor slot: leather piece carrying the equippable component pointing at
    // the armor export asset (<model>_<piece>). An empty slot can't be animated
    // (the _apply_auto data-modify needs an existing item), so the summon equips.
    const armor = api.generateDatapackFiles('walk', 8, 'mypack', 'equipment', 'head', 'stick', 'mymodel');
    const summon = armor.get('data/mypack/function/walk/summon.mcfunction');
    expect(summon).toMatch(/summon armor_stand/);
    expect(summon).toMatch(/equipment:\{head:\{/);
    expect(summon).toMatch(/leather_helmet/);
    expect(summon).toMatch(/asset_id:"minecraft:mymodel_helmet"/);

    // Hand slot: the base item with custom_model_data (mirrors the item_display).
    const hand = api.generateDatapackFiles('walk', 8, 'mypack', 'equipment', 'mainhand', 'stick', 'mymodel');
    const handSummon = hand.get('data/mypack/function/walk/summon.mcfunction');
    expect(handSummon).toMatch(/summon armor_stand/);
    expect(handSummon).toMatch(/equipment:\{mainhand:\{/);
    expect(handSummon).toMatch(/"minecraft:custom_model_data":\{strings:\["mymodel"\]\}/);
  });

  it('play_once emits a tick latch that freezes after nframes ticks', () => {
    const files = api.generateDatapackFiles('walk', 10, 'mypack', 'equipment', 'mainhand');
    // play_once stores an absolute deadline = gametime + nframes in objective <id>.end
    const playOnce = files.get('data/mypack/function/walk/play_once.mcfunction');
    expect(playOnce).toMatch(/execute store result score @s objcubed\.walk\.end run time query gametime/);
    expect(playOnce).toMatch(/scoreboard players add @s objcubed\.walk\.end 10/); // + nframes
    // init registers the new objective
    const init = files.get('data/mypack/function/walk/init.mcfunction');
    expect(init).toMatch(/scoreboard objectives add objcubed\.walk\.end dummy/);
    // a minecraft:tick tag drives the per-entity check
    expect(files.has('data/minecraft/tags/function/tick.json')).toBe(true);
    const tickTag = JSON.parse(files.get('data/minecraft/tags/function/tick.json'));
    expect(tickTag.values).toContain('mypack:walk/tick');
    expect(files.has('data/mypack/function/walk/zzz/_latch_once.mcfunction')).toBe(true);
    const latch = files.get('data/mypack/function/walk/zzz/_latch_once.mcfunction');
    expect(latch).toMatch(/scoreboard players set @s objcubed\.walk 9/);          // last frame = nframes-1
    expect(latch).toMatch(/tag @s remove walk\.once/);
    // referential closure: tick.mcfunction and _check_once must exist
    expect(files.has('data/mypack/function/walk/tick.mcfunction')).toBe(true);
    expect(files.has('data/mypack/function/walk/zzz/_check_once.mcfunction')).toBe(true);
  });
it('armor slots drive minecraft:dyed_color; hand slots keep potion_contents (prefix objcubed.)', () => {
    const armor = api.generateDatapackFiles('walk', 10, 'mypack', 'equipment', 'chest');
    const armorApply = armor.get('data/mypack/function/walk/zzz/_apply_auto.mcfunction');
    expect(armorApply).toMatch(/"minecraft:dyed_color" set value 0/);
    expect(armorApply).toMatch(/"minecraft:dyed_color" int 1 run scoreboard players get @s objcubed\.walk/);
    expect(armorApply).not.toMatch(/potion_contents/);
    const hand = api.generateDatapackFiles('walk', 10, 'mypack', 'equipment', 'mainhand');
    const handApply = hand.get('data/mypack/function/walk/zzz/_apply_auto.mcfunction');
    expect(handApply).toMatch(/"minecraft:potion_contents"\.custom_color int 1/);
    expect(handApply).not.toMatch(/dyed_color/);
  });
});
