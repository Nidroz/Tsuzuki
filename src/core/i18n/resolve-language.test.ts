import { describe, expect, it } from '@jest/globals';

import type { Language, LanguagePreference } from './languages';
import { resolveLanguage } from './resolve-language';

describe('resolveLanguage', () => {
  describe.each<Language>(['en', 'fr'])('with the explicit preference %s', (language) => {
    it.each<[string, unknown]>([
      ['french device tags', ['fr-FR']],
      ['english device tags', ['en-US']],
      ['unsupported device tags', ['de-DE']],
      ['no device tags', []],
      ['a malformed report', undefined],
    ])('ignores %s', (_label, deviceTags) => {
      expect(resolveLanguage(language, deviceTags)).toBe(language);
    });
  });

  describe('with the system preference', () => {
    const SYSTEM: LanguagePreference = 'system';

    it.each<[string, unknown, Language]>([
      ['a french tag', ['fr-FR'], 'fr'],
      ['a regional french tag', ['fr-CA'], 'fr'],
      ['a posix-style, differently cased tag', ['FR_ca'], 'fr'],
      ['a bare language subtag', ['fr'], 'fr'],
      ['an english tag', ['en-GB'], 'en'],
      ['a script subtag', ['fr-Latn-FR'], 'fr'],
      ['a tag with surrounding whitespace', ['  fr-FR  '], 'fr'],
    ])('resolves %s', (_label, deviceTags, expected) => {
      expect(resolveLanguage(SYSTEM, deviceTags)).toBe(expected);
    });

    it('takes the first supported tag, most preferred first', () => {
      expect(resolveLanguage(SYSTEM, ['de-DE', 'fr-FR'])).toBe('fr');
      expect(resolveLanguage(SYSTEM, ['de-DE', 'en-US', 'fr-FR'])).toBe('en');
      expect(resolveLanguage(SYSTEM, ['fr-FR', 'en-US'])).toBe('fr');
    });

    it.each<[string, unknown]>([
      ['only unsupported tags', ['de-DE', 'ja-JP']],
      ['no tags', []],
      ['a tag whose primary subtag only starts like a supported one', ['fra-FR']],
      ['a tag that only contains a supported subtag later', ['de-FR']],
    ])('falls back to english with %s', (_label, deviceTags) => {
      expect(resolveLanguage(SYSTEM, deviceTags)).toBe('en');
    });

    it.each<[string, unknown]>([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'fr'],
      ['an object', {}],
      ['an object with a french tag', { 0: 'fr-FR', length: 1 }],
      ['a number', 42],
    ])('falls back to english when the report is not an array (%s)', (_label, deviceTags) => {
      expect(resolveLanguage(SYSTEM, deviceTags)).toBe('en');
    });

    it.each<[string, unknown]>([
      ['a number', 42],
      ['an empty string', ''],
      ['a blank string', '  '],
      ['a sentence', 'not a tag'],
      ['a one letter subtag', 'x'],
      ['a null entry', null],
      ['an object', { languageTag: 'en-US' }],
    ])('skips an invalid entry (%s) and resolves the next valid one', (_label, invalid) => {
      expect(resolveLanguage(SYSTEM, [invalid, 'fr-FR'])).toBe('fr');
      expect(resolveLanguage(SYSTEM, [invalid])).toBe('en');
    });

    it('resolves from the valid entries of a mixed report', () => {
      expect(resolveLanguage(SYSTEM, [42, '', '  ', 'not a tag', 'x', 'de-DE', ' fr-BE '])).toBe(
        'fr',
      );
    });
  });
});
