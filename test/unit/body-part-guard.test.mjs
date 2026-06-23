// Task C3 Part 1: applyBodyPartTags is a persistence boundary — it re-applies
// body-part tags read from a (possibly hand-edited / corrupt) .bbmodel onto the
// outliner groups. A bad map value (out-of-range index, non-number) must NOT be
// written onto a group, or faces get routed to a nonexistent part. Valid range
// is -1..7 (-1 = untagged, 0..7 = the eight humanoid parts).
//
// applyBodyPartTags reads `Group` as a free global; the helper loads the plugin
// into a vm sandbox, so we inject a fake Group via opts.globals before calling.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubedWithContext } = require('../helpers/load-plugin.cjs');

// Fresh sandbox per case so each gets its own Group.all groups.
function load(groups) {
  const { api } = loadObjcubedWithContext({ globals: { Group: { all: groups } } });
  return api;
}

describe('persistence: applyBodyPartTags range guard (C3 Part 1)', () => {
  it('rejects an out-of-range index and a non-number, leaving groups untouched', () => {
    const groups = [
      { uuid: 'a', objcubed_body_part: -1 },
      { uuid: 'b', objcubed_body_part: -1 },
    ];
    const api = load(groups);
    api.applyBodyPartTags({ a: 999, b: 'x' });
    expect(groups[0].objcubed_body_part).toBe(-1); // 999 out-of-range -> rejected
    expect(groups[1].objcubed_body_part).toBe(-1); // 'x' non-number   -> rejected
  });

  it('accepts a valid in-range index', () => {
    const groups = [{ uuid: 'a', objcubed_body_part: -1 }];
    const api = load(groups);
    api.applyBodyPartTags({ a: 3 });
    expect(groups[0].objcubed_body_part).toBe(3);
  });

  it('accepts the boundary values -1 and 7', () => {
    const groups = [
      { uuid: 'a', objcubed_body_part: 2 },
      { uuid: 'b', objcubed_body_part: 2 },
    ];
    const api = load(groups);
    api.applyBodyPartTags({ a: -1, b: 7 });
    expect(groups[0].objcubed_body_part).toBe(-1);
    expect(groups[1].objcubed_body_part).toBe(7);
  });
});
