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
const { loadColorPlugin } = require('../helpers/color-plugin.cjs');
const fs = require('node:fs');

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
      // animated texture (lives next to the animation block)
      'texanim',
      // output sub-section (per-parameter)
      'respack', 'baseitem', 'cmdname', 'equipment', 'equipslot',
      // color & advanced (per-parameter). 'interpolation' was retired: the
      // shader never read those header bits — the working texture cross-fade
      // is the fade toggle inside the animated-texture block ('texanim').
      'color', 'easing', 'autorotate', 'flags',
      // outliner right-click features that have no dialog control
      'emissive',
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

it.each(['en', 'ru'])('keeps %s dialog instructions in translated help and bindings in the equipment summary', language => {
  const plugin = loadColorPlugin({ language, persisted: { exportAsEquipment: true, equipmentTarget: 'camel_saddle' } });
  const state = plugin.openDialog(), template = plugin.dialogOptions.component.template;
  const dict = plugin.api.LANG[language];
  const keys = [...template.matchAll(/\bt\('([^']+)'\)/g)].map(m => m[1]);
  keys.push(...[...template.matchAll(/\bhelp\('([^']+)'\)/g)].map(m => 'help_' + m[1]));
  for (const key of keys) expect(dict[key], key).toBeTruthy();
  const equipment = template.slice(template.indexOf("{{t('animal_supported_parts')}}"),
    template.indexOf('v-if="exportAsEquipment && !isHorseEquipment"'));
  expect(equipment).toContain('{{animalPartLabels}}');
  expect(equipment).toContain(':data-tip="animalBindingsHelp"');
  expect(equipment).not.toContain('horseLayerCount');
  expect(state.animalBindingsHelp).toContain(dict.help_animalBindings);
  expect(state.animalBindingsHelp).toContain(dict.help_equipmentLayers);
  expect(state.animalDatapackTarget).toBe(state.animalTargets.find(t => t.id === 'camel_saddle').label);
  expect(state.animalPartLabels).toContain(language === 'ru' ? 'Левое ухо' : 'Left ear');
  for (const tip of template.matchAll(/<span class="oc-help"[^>]*>/g)) {
    expect(tip[0]).toContain('tabindex="0"');
    expect(tip[0]).toContain(':aria-label=');
  }
  for (const removed of ['horse_equipment_note', 'datapack_info', 'player_note', 'open_display_note'])
    expect(template).not.toContain(removed);
});

it('opens detailed help on keyboard focus as well as hover', () => {
  const code = fs.readFileSync(new URL('../../objcubed.js', import.meta.url), 'utf8');
  const start = code.indexOf('// Tooltip portal —'), end = code.indexOf('// Style the Export button', start);
  const classes = new Set(), attributes = {}, handlers = {}, style = { setProperty() {} };
  const tip = { id: '', style, setAttribute(k, v) { attributes[k] = v; },
    classList: { add(k) { classes.add(k); }, remove(k) { classes.delete(k); } },
    getBoundingClientRect() { return { width: 100, height: 50 }; } };
  const target = { getAttribute() { return 'Detailed help'; }, setAttribute(k, v) { attributes[k] = v; },
    getBoundingClientRect() { return { left: 100, top: 100, bottom: 120, width: 20 }; } };
  const component = { $el: { contains() { return true; }, addEventListener(name, callback) { handlers[name] = callback; } } };
  const document = { getElementById() { return null; }, createElement() { return tip; }, body: { appendChild() {} } };
  new Function('document', 'window', 'UI_SCALE', code.slice(start, end))
    .call(component, document, { innerWidth: 800 }, 1);
  const event = { target: { closest() { return target; } } };
  for (const [enter, leave] of [['focusin', 'focusout'], ['mouseover', 'mouseout']]) {
    handlers[enter](event);
    expect(tip.textContent).toBe('Detailed help');
    expect(classes.has('visible')).toBe(true);
    expect(attributes['aria-describedby']).toBe(tip.id);
    handlers[leave](event);
    expect(classes.has('visible')).toBe(false);
  }
});
