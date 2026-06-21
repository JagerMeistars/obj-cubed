// Task 0 validation: proves the autonomous harness can load the REAL plugin
// and reach its pure functions with no Blockbench/Electron present.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();

describe('harness smoke', () => {
  it('loads objcubed.js and exposes the pure functions', () => {
    for (const fn of [
      'generateDatapackFiles', 'buildItemSelector', 'saveSingleOutput', 'buildOutput',
      'buildVertexData', 'buildDisplayTransforms', 'parseObj', 'encodePNG',
    ]) {
      expect(typeof api[fn], fn).toBe('function');
    }
  });

  it('exposes both language dictionaries', () => {
    expect(api.LANG.en).toBeTruthy();
    expect(api.LANG.ru).toBeTruthy();
  });

  it('generateDatapackFiles returns a non-empty Map', () => {
    const files = api.generateDatapackFiles('walk', 5, 'objcubed', 'equipment', 'mainhand');
    // NOTE: the plugin runs in a vm realm, so its `Map`/`Array` are NOT the
    // test realm's. Cross-realm `instanceof Map` is always false. Use the
    // realm-agnostic tag check (and `Array.isArray`, which IS cross-realm safe).
    expect(Object.prototype.toString.call(files)).toBe('[object Map]');
    expect(files.size).toBeGreaterThan(0);
  });
});
