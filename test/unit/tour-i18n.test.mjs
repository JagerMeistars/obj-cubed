// Issue #4: guided coach-mark tour. The tour copy is fully bilingual; this test
// guards i18n PARITY for the tour without rendering the Vue dialog (DOM/visual
// behaviour — spotlight placement, scroll-into-view, the auto-once localStorage
// gate, replay — is covered by residualRisk, not here).
//
// Asserts:
//   1. The SET of every `tour*` key in LANG.en equals the set in LANG.ru (each
//      en tour key exists in ru and vice versa) — no orphan translations.
//   2. Every title/body key the tour steps reference (TOUR_STEP_KEYS) exists in
//      BOTH dictionaries, and is a non-empty string.
//   3. The expanded step set (welcome → texture/atlas, display, live preview,
//      transform, animation, autoplay/datapack, easing, color behaviors,
//      datapack control, equipment/armor, resource-pack, export) stays present
//      with substantive bilingual bodies so it cannot regress to a thin tour.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const tourKeys = (dict) => Object.keys(dict).filter((k) => k.startsWith('tour')).sort();

describe('tour i18n parity (#4)', () => {
  const api = loadObjcubed();

  it('exposes LANG.en, LANG.ru and the tour step key list', () => {
    expect(api.LANG).toBeTruthy();
    expect(api.LANG.en).toBeTruthy();
    expect(api.LANG.ru).toBeTruthy();
    expect(Array.isArray(api.TOUR_STEP_KEYS)).toBe(true);
    expect(api.TOUR_STEP_KEYS.length).toBeGreaterThan(0);
  });

  it('en and ru expose the identical SET of tour* keys', () => {
    const en = tourKeys(api.LANG.en);
    const ru = tourKeys(api.LANG.ru);
    // Both must be non-empty, and identical as sets (sorted arrays compared).
    expect(en.length).toBeGreaterThan(0);
    expect(en).toEqual(ru);
    // Belt-and-suspenders: explicit membership both directions.
    for (const k of en) expect(ru).toContain(k);
    for (const k of ru) expect(en).toContain(k);
  });

  it('every tour step title/body key resolves in BOTH dictionaries', () => {
    for (const key of api.TOUR_STEP_KEYS) {
      expect(typeof api.LANG.en[key]).toBe('string');
      expect(api.LANG.en[key].length).toBeGreaterThan(0);
      expect(typeof api.LANG.ru[key]).toBe('string');
      expect(api.LANG.ru[key].length).toBeGreaterThan(0);
    }
  });

  it('TOUR_STEPS title/body keys all appear in TOUR_STEP_KEYS', () => {
    expect(Array.isArray(api.TOUR_STEPS)).toBe(true);
    for (const step of api.TOUR_STEPS) {
      expect(api.TOUR_STEP_KEYS).toContain(step.titleKey);
      expect(api.TOUR_STEP_KEYS).toContain(step.bodyKey);
    }
  });

  it('the expanded tour teaches the full toolset (issue #4 follow-up)', () => {
    // The tour was expanded from ~7 steps to a richer set so newbies can
    // actually learn the tool. Guard the new coverage so it cannot silently
    // shrink back. Each topic below must be a real step with bilingual copy.
    const topics = [
      'welcome',
      // texture card
      'texture', 'atlas',
      // display card
      'display', 'preview', 'transform',
      // animation block (per-parameter)
      'animation', 'animselect', 'fps', 'range', 'autoplay',
      // datapack (per-parameter)
      'datapack', 'datapackid', 'datapacktarget',
      // output sub-section (per-parameter)
      'respack', 'baseitem', 'cmdname', 'equipment', 'equipslot',
      // color & advanced (per-parameter)
      'color', 'easing', 'interpolation', 'autorotate', 'flags',
      // export
      'export',
    ];
    expect(api.TOUR_STEPS.length).toBeGreaterThanOrEqual(topics.length);
    const titleKeys = api.TOUR_STEPS.map((s) => s.titleKey);
    for (const topic of topics) {
      const tKey = `tour_t_${topic}`;
      const bKey = `tour_b_${topic}`;
      expect(titleKeys).toContain(tKey);
      expect(api.TOUR_STEP_KEYS).toContain(tKey);
      expect(api.TOUR_STEP_KEYS).toContain(bKey);
      // Bodies are 2-3 sentences now — assert they are substantively longer
      // than a bare label in BOTH languages.
      expect(api.LANG.en[bKey].length).toBeGreaterThan(40);
      expect(api.LANG.ru[bKey].length).toBeGreaterThan(40);
    }
  });

  it('the control labels (buttons, counter) exist in both langs', () => {
    for (const k of ['tour_btn', 'tour_next', 'tour_back', 'tour_skip', 'tour_done', 'tour_step']) {
      expect(typeof api.LANG.en[k]).toBe('string');
      expect(typeof api.LANG.ru[k]).toBe('string');
    }
    // tour_step is a template the card substitutes {i}/{n} into.
    expect(api.LANG.en.tour_step).toContain('{i}');
    expect(api.LANG.en.tour_step).toContain('{n}');
    expect(api.LANG.ru.tour_step).toContain('{i}');
    expect(api.LANG.ru.tour_step).toContain('{n}');
  });
});
