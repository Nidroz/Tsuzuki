import { describe, expect, it, jest } from '@jest/globals';
import i18next, { type i18n as I18nInstance, type TOptions } from 'i18next';

import { createI18n, hasIntlPluralRules, type MissingKeyHandler } from './create-i18n';
import en from './en.json';
import fr from './fr.json';
import type { Language } from './languages';
import type { Resources } from './resources';
import type { TranslationKey } from './use-translation';

// fixture catalogs: each key shows one behavior of the instance
const FIXTURES: Resources = {
  en: {
    translation: {
      greeting: 'Hello {{name}}',
      onlyInEnglish: 'English only',
      items_one: '{{count}} item',
      items_other: '{{count}} items',
      nested: { deep: { key: 'Nested value' } },
    },
  },
  fr: {
    translation: {
      greeting: 'fr greeting {{name}}',
      items_one: '{{count}} fr-one',
      items_many: '{{count}} fr-many',
      items_other: '{{count}} fr-other',
      nested: { deep: { key: 'fr nested' } },
    },
  },
};

const MISSING_KEY = 'missing.key';

const createFixtureI18n = (language: Language, onMissingKey?: MissingKeyHandler) =>
  createI18n({ language, onMissingKey, resources: FIXTURES });

// t is typed with the keys of en.json (i18next.d.ts), which the fixture keys are not: this is the
// one place these tests leave the typed keys, to read the fixture catalogs. the typed keys have
// their own test (typed-keys.test.ts)
const translate = (instance: I18nInstance, key: string, options?: TOptions): string =>
  instance.t(key as TranslationKey, options);

describe('createI18n', () => {
  it('returns a new instance on each call, never the global i18next singleton', () => {
    const english = createFixtureI18n('en');
    const french = createFixtureI18n('fr');

    expect(english).not.toBe(french);
    expect(english).not.toBe(i18next);
    // the singleton is never initialized: its flag is not even set
    expect(i18next.isInitialized).not.toBe(true);
    expect(translate(english, 'greeting', { name: 'Ada' })).toBe('Hello Ada');
    expect(translate(french, 'greeting', { name: 'Ada' })).toBe('fr greeting Ada');
  });

  it('keeps each instance on its own language', async () => {
    const english = createFixtureI18n('en');
    const other = createFixtureI18n('en');

    await other.changeLanguage('fr');

    expect(english.language).toBe('en');
    expect(translate(english, 'greeting', { name: 'Ada' })).toBe('Hello Ada');
    expect(translate(other, 'greeting', { name: 'Ada' })).toBe('fr greeting Ada');
  });

  it('is initialized when it returns, with no pending work', () => {
    const french = createFixtureI18n('fr');

    expect(french.isInitialized).toBe(true);
    expect(french.language).toBe('fr');
    expect(french.resolvedLanguage).toBe('fr');
    expect(translate(french, 'nested.deep.key')).toBe('fr nested');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('falls back to english for a key only the english catalog has', () => {
    const onMissingKey = jest.fn<MissingKeyHandler>();

    expect(translate(createFixtureI18n('fr', onMissingKey), 'onlyInEnglish')).toBe('English only');
    // a key found in the fallback catalog is not missing: the parity test keeps fr.json complete
    expect(onMissingKey).not.toHaveBeenCalled();
  });

  it('does not escape interpolated values: react escapes rendered text', () => {
    const english = createFixtureI18n('en');

    expect(translate(english, 'greeting', { name: 'Tom & Jerry' })).toBe('Hello Tom & Jerry');
    expect(translate(english, 'greeting', { name: '<b>"Ada"</b>' })).toBe('Hello <b>"Ada"</b>');
  });

  it.each([
    [0, '0 items'],
    [1, '1 item'],
    [2, '2 items'],
    [1.5, '1.5 items'],
  ])('picks the english plural form for %s', (count, expected) => {
    expect(translate(createFixtureI18n('en'), 'items', { count })).toBe(expected);
  });

  it.each([
    [0, '0 fr-one'],
    [1, '1 fr-one'],
    [1.5, '1.5 fr-one'],
    [2, '2 fr-other'],
    [1000, '1000 fr-other'],
    [1_000_000, '1000000 fr-many'],
    [2_000_000, '2000000 fr-many'],
  ])('picks the french plural form for %s (one, many, other)', (count, expected) => {
    expect(translate(createFixtureI18n('fr'), 'items', { count })).toBe(expected);
  });

  describe.each<Language>(['en', 'fr'])('with a missing key handler, in %s', (language) => {
    it('reports a key found in no catalog with the active language', () => {
      const onMissingKey = jest.fn<MissingKeyHandler>();

      // i18next shows the key itself
      expect(translate(createFixtureI18n(language, onMissingKey), MISSING_KEY)).toBe(MISSING_KEY);
      expect(onMissingKey.mock.calls).toStrictEqual([[language, MISSING_KEY]]);
    });

    it('does not report a key the catalogs have', () => {
      const onMissingKey = jest.fn<MissingKeyHandler>();
      const instance = createFixtureI18n(language, onMissingKey);

      translate(instance, 'greeting', { name: 'Ada' });
      translate(instance, 'items', { count: 2 });
      translate(instance, 'nested.deep.key');

      expect(onMissingKey).not.toHaveBeenCalled();
    });

    it('reports a key missing from every catalog even with a default value', () => {
      const onMissingKey = jest.fn<MissingKeyHandler>();

      expect(
        translate(createFixtureI18n(language, onMissingKey), MISSING_KEY, {
          defaultValue: 'Default',
        }),
      ).toBe('Default');
      expect(onMissingKey.mock.calls).toStrictEqual([[language, MISSING_KEY]]);
    });
  });

  it('reports each plural form of the language for a missing plural key', () => {
    const onMissingKey = jest.fn<MissingKeyHandler>();

    translate(createFixtureI18n('fr', onMissingKey), MISSING_KEY, { count: 2 });

    expect(onMissingKey.mock.calls).toStrictEqual([
      ['fr', `${MISSING_KEY}_one`],
      ['fr', `${MISSING_KEY}_many`],
      ['fr', `${MISSING_KEY}_other`],
    ]);
  });

  it('shows the key without a handler, silently and without throwing', () => {
    const instance = createFixtureI18n('fr');

    expect(translate(instance, MISSING_KEY)).toBe(MISSING_KEY);
    expect(translate(instance, MISSING_KEY, { count: 2 })).toBe(MISSING_KEY);
  });

  it.each<[Language, string]>([
    ['en', en.home.title],
    ['fr', fr.home.title],
  ])('translates with the bundled catalogs by default (%s)', (language, title) => {
    const onMissingKey = jest.fn<MissingKeyHandler>();

    expect(createI18n({ language, onMissingKey }).t('home.title')).toBe(title);
    expect(onMissingKey).not.toHaveBeenCalled();
  });
});

describe('hasIntlPluralRules', () => {
  it('is true where Intl.PluralRules exists', () => {
    expect(hasIntlPluralRules()).toBe(true);
  });

  it('is false without Intl.PluralRules', () => {
    const { PluralRules } = Intl;
    Reflect.deleteProperty(Intl, 'PluralRules');
    try {
      expect(hasIntlPluralRules()).toBe(false);
    } finally {
      Object.defineProperty(Intl, 'PluralRules', {
        configurable: true,
        writable: true,
        value: PluralRules,
      });
    }
    expect(hasIntlPluralRules()).toBe(true);
  });

  it('is false without Intl', () => {
    const intl = Intl;
    Reflect.deleteProperty(globalThis, 'Intl');
    try {
      expect(hasIntlPluralRules()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'Intl', {
        configurable: true,
        writable: true,
        value: intl,
      });
    }
    expect(hasIntlPluralRules()).toBe(true);
  });
});
