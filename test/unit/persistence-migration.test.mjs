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

// Capture the real dialog component without a DOM, Vue, or a Blockbench launch.
// Stop initialization at the Action/Dialog constructors so unrelated editor
// integration never executes, then run the actual data/persistence overlay.
function dialogState(project) {
  let registration, action, component;
  const captured = new Error('captured editor constructor');
  const { api } = loadObjcubedWithContext({ globals: {
    Project: project,
    Texture: { all: [{ name: 'test', source: '' }] },
    Animation: { all: [] },
    Outliner: { root: [] },
    BBPlugin: { register(_id, options) { registration = options; } },
    Action: class { constructor(_id, options) { action = options; throw captured; } },
    Dialog: class { constructor(options) { component = options.component; throw captured; } },
  } });
  expect(() => registration.onload()).toThrow(captured);
  expect(() => action.click()).toThrow(captured);
  return { api, component, state: component.data() };
}

describe('persistence: flat settings + old-preset migration (B3)', () => {
  it('defaults fresh projects to both autorotate axes (enum value 3)', () => {
    const { state, component, api } = dialogState({ name: 'fresh' });
    expect(state.autorotate).toBe(3);
    expect(component.template).toMatch(/<option\s+:value="3">\{\{t\('opt_both'\)\}\}<\/option>/);
    expect([...api.PERSISTABLE_FIELDS]).toContain('autorotate');
  });

  it.each([0, 1, 2, 3])('preserves explicit autorotate %i from saved projects', autorotate => {
    const { state } = dialogState({ name: 'saved', objcubed_data: { version: 1, settings: { autorotate } } });
    expect(state.autorotate).toBe(autorotate);
  });

  it('keeps the autorotate choice when migrating an old active preset', () => {
    const { state } = dialogState({ name: 'legacy', objcubed_data: {
      version: 1, activePresetIndex: 1,
      presets: [{ name: 'a', settings: { autorotate: 3 } }, { name: 'b', settings: { autorotate: 0 } }],
    } });
    expect(state.autorotate).toBe(0);
  });

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
