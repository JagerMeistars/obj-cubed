import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { loadColorPlugin } = require('../helpers/color-plugin.cjs');

const MODES = ['direct', 'time', 'scale', 'overlay', 'hurt'];
const OBJ = [
  'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
  'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
  'usemtl m_u', 'f 1/1 2/2 3/3 4/4',
].join('\n');
const cfg = extra => ({
  texIndex: 0, useAtlas: false, texAnimEnabled: false, nopow: false,
  scale: 1, offset: [0, 0, 0], duration: 0, autoplay: false,
  easing: 0, interpolation: 0, noshadow: false, autorotate: 0,
  visibility: 0, displaySlots: {}, flipuv: false,
  colorbehavior: ['direct', 'direct', 'direct'], ...extra,
});
const channels = state => [state.cbR, state.cbG, state.cbB];

describe('color behavior encoder contract', () => {
  it('round-trips all 125 mode combinations in the PNG without corrupting neighboring flags', async () => {
    const { api } = loadColorPlugin();
    for (const highFlags of [false, true]) {
      for (let r = 0; r < 5; r++) for (let g = 0; g < 5; g++) for (let b = 0; b < 5; b++) {
        const modes = [MODES[r], MODES[g], MODES[b]];
        const result = await api.buildOutput(cfg({
          colorbehavior: modes, noshadow: highFlags, autorotate: highFlags ? 3 : 0,
          visibility: highFlags ? 7 : 0,
          displaySlots: highFlags ? { ground: { rotation: [20, 0, 0] } } : {},
        }), [OBJ], '');
        const png = PNG.sync.read(Buffer.from(result.pngBuffer));
        const [flags, low, version, alpha] = png.data.subarray(6 * 4, 7 * 4);
        const word = (flags & 1) * 256 + low;
        const context = `${modes.join('/')} highFlags=${highFlags}`;
        expect(word, context).toBe(r * 64 + g * 8 + b);
        expect([(word >> 6) & 7, (word >> 3) & 7, word & 7], context).toEqual([r, g, b]);
        expect(flags & 254, context).toBe(highFlags ? 254 : 0);
        expect([version, alpha], context).toEqual([2, 255]);
      }
    }
  });

  it('encodes the special all-time datapack word as 73 and rejects unknown modes', async () => {
    const { api } = loadColorPlugin();
    const result = await api.buildOutput(cfg({ colorbehavior: ['time', 'time', 'time'] }), [OBJ], '');
    expect(((result.rawBuf[24] & 1) << 8) | result.rawBuf[25]).toBe(73);
    await expect(api.buildOutput(cfg({ colorbehavior: ['direct', 'unknown', 'direct'] }), [OBJ], ''))
      .rejects.toThrow('Unknown colorbehavior: unknown');
  });
});

describe('color behavior dialog state and export', () => {
  it('starts with RGB tint and cycles each channel independently back to tint', () => {
    const { openDialog } = loadColorPlugin();
    const state = openDialog();
    expect(channels(state)).toEqual(['direct', 'direct', 'direct']);
    for (const key of ['cbR', 'cbG', 'cbB']) {
      for (const expected of ['time', 'overlay', 'hurt', 'direct']) {
        state.cycleCb(key);
        expect(state[key]).toBe(expected);
        for (const other of ['cbR', 'cbG', 'cbB'].filter(x => x !== key)) expect(state[other]).toBe('direct');
      }
    }
  });

  it('preserves all presets, including legacy scale, through project persistence and reopen', () => {
    const plugin = loadColorPlugin();
    let state = plugin.openDialog();
    for (const [preset, mode] of [['tint', 'direct'], ['anim', 'time'], ['scale', 'scale'], ['overlay', 'overlay'], ['hurt', 'hurt']]) {
      state.applyColorPreset(preset);
      expect(channels(state)).toEqual([mode, mode, mode]);
      expect(state.colorBehaviorPreset).toBe(preset);
      state = plugin.openDialog();
      expect(channels(state)).toEqual([mode, mode, mode]);
      expect(state.colorBehaviorPreset).toBe(preset);
    }
    state.applyColorPreset('scale');
    state.cycleCb('cbR');
    expect(channels(state)).toEqual(['direct', 'scale', 'scale']);
    expect(state.colorBehaviorPreset).toBeNull();
    state.applyColorPreset('unknown');
    expect(channels(state)).toEqual(['direct', 'scale', 'scale']);
  });

  it('overrides only exported settings for a datapack and restores mixed user choices when disabled', async () => {
    const plugin = loadColorPlugin({ persisted: {
      cbR: 'direct', cbG: 'overlay', cbB: 'hurt', animationEnabled: true, autoplay: true,
    } });
    let exported;
    plugin.api.setExportSink(async value => { exported = value; });
    const state = plugin.openDialog();
    await state.doExport();
    expect(exported.colorbehavior).toEqual(['direct', 'overlay', 'hurt']);
    expect(exported.autoplay).toBe(true);
    const userPng = await plugin.api.buildOutput(exported, [OBJ], '');
    expect(((userPng.rawBuf[24] & 1) << 8) | userPng.rawBuf[25]).toBe(28);
    expect(userPng.rawBuf[4 * 4 + 3] & 64).toBe(64);
    state.generateDatapack = true;
    expect(state.colorBehaviorForcedByDatapack).toBe(true);
    expect(state.colorBehaviorPretty).toBe(plugin.api.LANG.en.color_all_time);
    state.cycleCb('cbR');
    state.applyColorPreset('hurt');
    expect(channels(state)).toEqual(['direct', 'overlay', 'hurt']);
    await state.doExport();
    expect(exported.colorbehavior).toEqual(['time', 'time', 'time']);
    expect(exported.generateDatapack).toBe(true);
    expect(exported.duration).toBe(0);
    expect(exported.autoplay).toBe(false);
    const datapackPng = await plugin.api.buildOutput(exported, [OBJ], '');
    expect(((datapackPng.rawBuf[24] & 1) << 8) | datapackPng.rawBuf[25]).toBe(73);
    expect(datapackPng.rawBuf[4 * 4 + 3] & 64).toBe(0);
    expect(state.autoplay).toBe(true);
    expect(channels(plugin.openDialog())).toEqual(['direct', 'overlay', 'hurt']);
    state.generateDatapack = false;
    await state.doExport();
    expect(exported.colorbehavior).toEqual(['direct', 'overlay', 'hurt']);
    expect(exported.autoplay).toBe(true);
    expect(exported.duration).toBe(40);
  });

  it('ignores a persisted datapack flag when animation is disabled or unavailable', async () => {
    for (const animations of [false, true]) {
      const plugin = loadColorPlugin({ animations, persisted: {
        generateDatapack: true, animationEnabled: !animations, cbR: 'hurt', cbG: 'time', cbB: 'overlay',
      } });
      let exported;
      plugin.api.setExportSink(async value => { exported = value; });
      const state = plugin.openDialog();
      expect(state.colorBehaviorForcedByDatapack).toBe(false);
      await state.doExport();
      expect(exported.generateDatapack).toBe(false);
      expect(exported.colorbehavior).toEqual(['hurt', 'time', 'overlay']);
    }
  });

  for (const language of ['en', 'ru']) {
    it(`labels each supported mode and uniform summary in ${language}`, () => {
      const plugin = loadColorPlugin({ language });
      const state = plugin.openDialog();
      for (const mode of MODES) {
        state.cbR = state.cbG = state.cbB = mode;
        expect(state.cbLabel(mode)).toBe(plugin.api.LANG[language][`cb_${mode}`]);
        expect(state.colorBehaviorPretty).toBe(plugin.api.LANG[language][`color_all_${mode}`]);
      }
    });
  }
});
