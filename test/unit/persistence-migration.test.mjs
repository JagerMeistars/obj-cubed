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
function dialogState(project, textures = [{ name: 'test', source: '' }]) {
  let registration, action, component;
  const captured = new Error('captured editor constructor');
  const { api } = loadObjcubedWithContext({ globals: {
    Project: project,
    Texture: { all: textures },
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
  it('detects the tagged skin texture when reopening a project with different saved selection', () => {
    const { state } = dialogState({ name: 'skin', objcubed_data: { version: 1,
      settings: { skinEnabled: false, selectedTex: 0 } } }, [
      { name: 'paint' }, { name: 'renamed reference', objcubed_player_skin: true },
    ]);
    expect(state.skinAutomatic).toBe(true);
    expect(state.skinEnabled).toBe(true);
    expect(state.skinFromTexture).toBe(true);
    expect(state.selectedTex).toBe(1);
  });

  it('does not apply skin to ordinary textures after the tagged reference is removed', () => {
    const { state } = dialogState({ name: 'skin', objcubed_data: { version: 1,
      settings: { skinEnabled: true, skinFromTexture: true, selectedTex: 0 } } });
    expect(state.skinAutomatic).toBe(false);
    expect(state.skinEnabled).toBe(false);
    expect(state.skinFromTexture).toBe(false);
  });

  it('detects animated ordinary textures beside the automatic skin reference', () => {
    const {state,component}=dialogState({name:'mixed'},[
      {name:'reference',width:64,height:64,objcubed_player_skin:true},
      {name:'paint',width:64,height:128,uv_width:64,uv_height:64,display_height:64,frameCount:2},
    ]);
    state.useAtlas=false;
    expect(component.computed.texFrameCount.call(state)).toBe(2);
    expect(component.template).not.toContain('!multiTex || skinEnabled');
    const texture=component.template.indexOf('oc-tour-texture');
    const anim=component.template.indexOf('oc-tour-texanim');
    const display=component.template.indexOf('<!-- ======== DISPLAY');
    expect(anim).toBeGreaterThan(texture);expect(anim).toBeLessThan(display);
  });

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
