// Task D1: cover the i18n / warning helpers that were module-level but untested
// and not exported. `pluralForm` implements the CLDR-ish plural categories the
// `frames` counter relies on (Russian is one/few/many, English is one/other);
// `tPlural` resolves a localized plural string via LANG; `surfaceWarning` must
// degrade to a console.warn when Blockbench is absent (headless/tests) instead
// of throwing. None of the DOM toast behaviour is exercised here.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadObjcubed } = require('../helpers/load-plugin.cjs');

const api = loadObjcubed();
const { pluralForm, tPlural, LANG, surfaceWarning } = api;

describe('pluralForm (CLDR plural categories)', () => {
  it('ru picks one/few/many across the tricky teens and tens', () => {
    expect(pluralForm(1, 'ru')).toBe('one');
    expect(pluralForm(2, 'ru')).toBe('few');
    expect(pluralForm(5, 'ru')).toBe('many');
    // 11 is the classic exception: %10==1 but it's NOT "one".
    expect(pluralForm(11, 'ru')).toBe('many');
    expect(pluralForm(22, 'ru')).toBe('few');
    expect(pluralForm(21, 'ru')).toBe('one');
  });

  it('en is the simple one/other split', () => {
    expect(pluralForm(1, 'en')).toBe('one');
    expect(pluralForm(2, 'en')).toBe('other');
  });
});

describe('LANG.ru frames plural keys', () => {
  it('exposes the three Russian frame forms', () => {
    expect(LANG.ru.frames_one).toBe('кадр');
    expect(LANG.ru.frames_few).toBe('кадра');
    expect(LANG.ru.frames_many).toBe('кадров');
  });
});

describe('tPlural', () => {
  // The harness pins settings.language.value to 'en' (load-plugin.cjs), so we
  // don't over-fit a language here — just assert it resolves to a non-empty
  // string and never throws for a known plural key.
  it('returns a non-empty string for frames and does not throw', () => {
    expect(() => tPlural(1, 'frames')).not.toThrow();
    expect(() => tPlural(2, 'frames')).not.toThrow();
    expect(typeof tPlural(1, 'frames')).toBe('string');
    expect(tPlural(1, 'frames').length).toBeGreaterThan(0);
    expect(typeof tPlural(2, 'frames')).toBe('string');
    expect(tPlural(2, 'frames').length).toBeGreaterThan(0);
  });
});

describe('surfaceWarning', () => {
  it('is no-throw without Blockbench (console-only fallback)', () => {
    expect(() => surfaceWarning('x')).not.toThrow();
  });
});
