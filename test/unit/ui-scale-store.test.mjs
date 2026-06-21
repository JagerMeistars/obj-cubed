// Issue #6: the export dialog now renders at a single FIXED enlarged scale
// (the old "Large" = 1.25). The per-user Compact/Normal/Large toggle and its
// localStorage store were removed — the smaller sizes weren't needed. The whole
// stylesheet AND every inline template font-size read var(--oc-scale); we pin
// that var on .oc-root and the tooltip portal, so all text scales together.
//
// This is a source-shape guard: it proves the scale is a constant (no dead
// store), the root pins it, and no inline font-size escaped the var. The live
// Vue/CSS rendering is DOM-only and stays in residualRisk.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed, REPO_ROOT } = require('../helpers/load-plugin.cjs');
const SRC = readFileSync(`${REPO_ROOT}/objcubed.js`, 'utf8');

describe('UI scale (#6) — fixed Large, no per-user store', () => {
  it('exposes UI_SCALE as the old Large constant (1.25)', () => {
    const api = loadObjcubed();
    expect(api.UI_SCALE).toBe(1.25);
  });

  it('pins --oc-scale to 1.25 on .oc-root in the stylesheet', () => {
    expect(SRC).toMatch(/--oc-scale:\s*1\.25/);
  });

  it('has no leftover per-user UI-scale store or toggle', () => {
    for (const dead of [
      'loadUiScale', 'saveUiScale', 'UI_SCALE_MIN', 'UI_SCALE_MAX',
      'UI_SCALE_DEFAULT', 'objcubed_ui_scale', 'uiScale',
      'lbl_ui_scale', 'ui_scale_compact', 'help_uiScale',
    ]) {
      expect(SRC, `dead reference still present: ${dead}`).not.toContain(dead);
    }
  });

  it('every inline template font-size scales via var(--oc-scale)', () => {
    const bare = SRC.match(/style="[^"]*font-size:\s*\d+px(?![^"]*var\(--oc-scale\))/g) || [];
    expect(bare).toEqual([]);
  });

  it('does NOT add uiScale to the per-project PERSISTABLE_FIELDS', () => {
    const api = loadObjcubed();
    expect([...api.PERSISTABLE_FIELDS]).not.toContain('uiScale');
  });
});
