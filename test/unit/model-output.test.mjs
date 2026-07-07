// Issue A/B: per-slot model JSON is minified and carries a particle texture.
// Drives the pure helper buildSlotModelJson extracted from saveSingleOutput.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();

const someDisplay = {
  thirdperson_righthand: {
    rotation:    [10, 20, 30],
    translation: [1, 2, 3],
    scale:       [0.5, 0.5, 0.5],
  },
};

const someElements = [
  {
    from: [0, 0, 0],
    to:   [16, 16, 16],
    faces: {
      north: { uv: [0, 0, 16, 16], texture: '#0' },
      south: { uv: [0, 0, 16, 16], texture: '#0' },
    },
  },
];

describe('buildSlotModelJson', () => {
  it('exposes the pure helper', () => {
    expect(typeof api.buildSlotModelJson).toBe('function');
  });

  const s = () => api.buildSlotModelJson('cat', 'thirdperson_righthand', someDisplay, someElements);

  it('returns canonical minified JSON (no whitespace, no newlines)', () => {
    const out = s();
    // Round-trips to itself => no indentation/whitespace anywhere.
    expect(out).toBe(JSON.stringify(JSON.parse(out)));
    expect(out.includes('\n')).toBe(false);
  });

  it('carries both the base and particle textures', () => {
    const m = JSON.parse(s());
    expect(m.textures['0']).toBe('objcubed:item/cat');
    expect(m.textures.particle).toBe('objcubed:item/cat');
  });

  it('preserves elements and display verbatim', () => {
    const m = JSON.parse(s());
    expect(m.elements).toEqual(someElements);
    expect(m.display).toEqual(someDisplay);
  });
});

// Item def must carry the MANDATORY top-level `hand_animation_on_swap: false`.
// Without it (default true) Minecraft replays the item-swap animation every
// time obj³ mutates the item's components per animation frame -> broken hand
// animation. Build emits it; merge heals an old file that lacks it.
describe('buildItemSelector: hand_animation_on_swap', () => {
  it('emits hand_animation_on_swap:false as a top-level sibling of model', () => {
    const out = api.buildItemSelector('m', ['gui'], 'stick');
    expect(out.hand_animation_on_swap).toBe(false);
  });

  it('still produces the custom_model_data select with the model case', () => {
    const out = api.buildItemSelector('m', ['gui'], 'stick');
    expect(out.model.type).toBe('minecraft:select');
    expect(out.model.property).toBe('minecraft:custom_model_data');
    expect(out.model.cases.some(c => c.when === 'm')).toBe(true);
  });

  it('merge heals an existing item.json lacking the field', () => {
    const existing = {
      model: {
        type: 'minecraft:select',
        property: 'minecraft:custom_model_data',
        index: 0,
        cases: [{ when: 'old', model: { type: 'minecraft:model', model: 'x' } }],
        fallback: { type: 'minecraft:model', model: 'minecraft:item/stick' },
      },
    };
    const merged = api.mergeItemSelector(existing, 'm', ['gui']);
    expect(merged.hand_animation_on_swap).toBe(false);
    expect(merged.model.cases.some(c => c.when === 'm')).toBe(true);
    expect(merged.model.cases.some(c => c.when === 'old')).toBe(true);
  });
});

// display-1:1 step A2: buildDisplayTransforms now KEEPS scale for firstperson
// (vanilla owns the full hand transform; the shader no longer applies a hand
// scale). Previously firstperson scale was force-stripped to [1,1,1].
describe('buildDisplayTransforms: firstperson scale revert (A2)', () => {
  it('KEEPS a non-identity firstperson scale in the output display', () => {
    const out = api.buildDisplayTransforms({ displaySlots: {
      firstperson_righthand: { rotation: [0,0,0], translation: [0,0,0], scale: [3,3,3] },
    } });
    expect(out.firstperson_righthand).toBeDefined();
    expect(out.firstperson_righthand.scale).toEqual([3,3,3]);
  });

  it('still flows rotation/translation for firstperson alongside scale', () => {
    const out = api.buildDisplayTransforms({ displaySlots: {
      firstperson_lefthand: { rotation: [10,0,0], translation: [0,2,0], scale: [0.5,0.5,0.5] },
    } });
    expect(out.firstperson_lefthand).toEqual({
      rotation: [10,0,0], translation: [0,2,0], scale: [0.5,0.5,0.5],
    });
  });

  it('an identity firstperson slot still yields no entry', () => {
    const out = api.buildDisplayTransforms({ displaySlots: {
      firstperson_righthand: { rotation: [0,0,0], translation: [0,0,0], scale: [1,1,1] },
    } });
    expect(out.firstperson_righthand).toBeUndefined();
  });
});

// display-1:1 step A1: hasStaticWorldDisplay — pure detector for the gate bit.
describe('hasStaticWorldDisplay (A1 gate detector)', () => {
  it('is exported', () => {
    expect(typeof api.hasStaticWorldDisplay).toBe('function');
  });

  it('false for empty / all-identity world slots', () => {
    expect(api.hasStaticWorldDisplay({})).toBe(false);
    expect(api.hasStaticWorldDisplay({ displaySlots: {} })).toBe(false);
    expect(api.hasStaticWorldDisplay({ displaySlots: {
      thirdperson_righthand: { rotation: [0,0,0], translation: [0,0,0], scale: [1,1,1] },
      head: {}, ground: {}, fixed: {}, on_shelf: {},
    } })).toBe(false);
  });

  it('true when any world slot is non-identity (rotation / translation / scale)', () => {
    expect(api.hasStaticWorldDisplay({ displaySlots: { fixed: { rotation: [0,45,0] } } })).toBe(true);
    expect(api.hasStaticWorldDisplay({ displaySlots: { on_shelf: { translation: [0,1,0] } } })).toBe(true);
    expect(api.hasStaticWorldDisplay({ displaySlots: { head: { scale: [2,2,2] } } })).toBe(true);
  });

  it('ignores gui and firstperson_* (not world slots)', () => {
    expect(api.hasStaticWorldDisplay({ displaySlots: {
      gui: { rotation: [0,30,0], scale: [2,2,2] },
      firstperson_righthand: { scale: [3,3,3] },
      firstperson_lefthand: { translation: [1,0,0] },
    } })).toBe(false);
  });
});
