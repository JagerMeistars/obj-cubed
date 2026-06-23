// Task C1: array-guard atlasTexChecked at export.
//
// The export dialog built `atlasTexIndices` as
//   this.atlasTexChecked.map((v,i)=>v?i:-1).filter(i=>i>=0)
// with NO array guard (objcubed.js export cfg site). A hand-edited / corrupt
// .bbmodel whose persisted `atlasTexChecked` is a non-array (null / string /
// object) made the user's "Export" click throw `TypeError: …map is not a
// function`. (`selectedPieces` right next to it WAS guarded with Array.isArray.)
//
// The fix extracts a module-level pure helper `atlasTexIndicesFrom(checked)`
// that coerces a non-array to [] before mapping, so the export always produces
// a (possibly empty) index array. The empty-array case is harmless downstream:
// the consumer does `cfg.useAtlas && cfg.atlasTexIndices` → `new Set(...)`,
// which over [] just yields an empty allowed-set.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

describe('atlasTexIndicesFrom: array-guard atlasTexChecked (C1)', () => {
  it('maps a boolean checkbox array to the checked indices', () => {
    const { atlasTexIndicesFrom } = loadObjcubed();
    expect(atlasTexIndicesFrom([false, true, false, true])).toEqual([1, 3]);
  });

  it('coerces null to [] (was a TypeError on .map)', () => {
    const { atlasTexIndicesFrom } = loadObjcubed();
    expect(atlasTexIndicesFrom(null)).toEqual([]);
  });

  it('coerces a string to []', () => {
    const { atlasTexIndicesFrom } = loadObjcubed();
    expect(atlasTexIndicesFrom('oops')).toEqual([]);
  });

  it('coerces undefined to []', () => {
    const { atlasTexIndicesFrom } = loadObjcubed();
    expect(atlasTexIndicesFrom(undefined)).toEqual([]);
  });
});
