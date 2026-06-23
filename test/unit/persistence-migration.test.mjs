// Task B3: the per-project data root collapses from the single-preset backbone
// {version, activePresetIndex, presets:[{name, settings}]} to a flat
// {version, settings:{}}. ensureDataRoot() migrates old blobs in place so
// projects saved by older builds still load their settings.
//
// A fresh vm context is loaded per case so each gets its own Project global;
// the plugin's persistence functions read Project as a free global resolved
// against the sandbox, so mutating context.Project before the call drives them.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');

function load(project) {
  const { api, context } = loadObjcubedWithContext({ globals: { Project: project } });
  return { api, project: context.Project };
}

describe('persistence: flat settings + old-preset migration (B3)', () => {
  it('migrates an old presets[] blob into root.settings and drops legacy keys', () => {
    const { api, project } = load({
      objcubed_data: {
        version: 1,
        activePresetIndex: 0,
        presets: [{ name: 'default', settings: { baseItem: 'magma_cream' } }],
      },
    });
    const settings = api.loadActiveSettings();
    expect(settings).toEqual({ baseItem: 'magma_cream' });
    expect(project.objcubed_data.settings.baseItem).toBe('magma_cream');
    expect(project.objcubed_data.presets).toBeUndefined();
    expect(project.objcubed_data.activePresetIndex).toBeUndefined();
  });

  it('migrates using activePresetIndex when it points past index 0', () => {
    const { api } = load({
      objcubed_data: {
        version: 1,
        activePresetIndex: 1,
        presets: [
          { name: 'a', settings: { baseItem: 'apple' } },
          { name: 'b', settings: { baseItem: 'bone' } },
        ],
      },
    });
    expect(api.loadActiveSettings()).toEqual({ baseItem: 'bone' });
  });

  it('gives a fresh project a flat settings object with no legacy keys', () => {
    const { api, project } = load({});
    const settings = api.loadActiveSettings();
    expect(settings).toBeTypeOf('object');
    expect(settings).not.toBeNull();
    expect(project.objcubed_data.settings).toBeTypeOf('object');
    expect(project.objcubed_data.presets).toBeUndefined();
    expect(project.objcubed_data.activePresetIndex).toBeUndefined();
  });

  it('round-trips saveActiveSettings -> loadActiveSettings', () => {
    const { api } = load({});
    api.saveActiveSettings({ a: 1 });
    expect(api.loadActiveSettings()).toEqual({ a: 1 });
  });

  it('returns null when no project is open', () => {
    const { api } = load(undefined);
    expect(api.loadActiveSettings()).toBeNull();
  });
});
