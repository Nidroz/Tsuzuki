import { describe, expect, it } from '@jest/globals';

import { deviceLanguageTagsSchema, parseDeviceLanguageTags } from './device-language-tags';

describe('parseDeviceLanguageTags', () => {
  it.each([
    ['a language subtag', 'fr'],
    ['a three letter language subtag', 'fil'],
    ['a region', 'fr-CA'],
    ['a script and a region', 'zh-Hant-TW'],
    ['a posix-style separator', 'fr_CA'],
    ['mixed case', 'FR_ca'],
    ['a numeric region', 'es-419'],
    ['an extension', 'de-DE-u-co-phonebk'],
  ])('keeps a tag with %s', (_label, tag) => {
    expect(parseDeviceLanguageTags([tag])).toStrictEqual([tag]);
  });

  it('trims the whitespace around a tag', () => {
    expect(parseDeviceLanguageTags([' fr-FR ', '\ten-US\n'])).toStrictEqual(['fr-FR', 'en-US']);
  });

  it.each<[string, unknown]>([
    ['a number', 42],
    ['an empty string', ''],
    ['a blank string', '  '],
    ['a sentence', 'not a tag'],
    ['a one letter subtag', 'x'],
    ['a four letter language subtag', 'engl-US'],
    ['a subtag longer than eight characters', 'en-abcdefghi'],
    ['an empty subtag', 'en--US'],
    ['a trailing separator', 'en-'],
    ['a non-ascii letter', 'fé-FR'],
    ['null', null],
    ['undefined', undefined],
    ['an object', { languageTag: 'en-US' }],
    ['an array', ['en-US']],
  ])('drops an invalid entry: %s', (_label, entry) => {
    expect(parseDeviceLanguageTags(['en-US', entry, 'fr-FR'])).toStrictEqual(['en-US', 'fr-FR']);
  });

  it('keeps the order of the valid entries', () => {
    expect(parseDeviceLanguageTags(['ja-JP', 42, 'fr-FR', '', 'en-US', 'de'])).toStrictEqual([
      'ja-JP',
      'fr-FR',
      'en-US',
      'de',
    ]);
  });

  it('keeps duplicates, which do not change the first supported tag', () => {
    expect(parseDeviceLanguageTags(['fr-FR', 'fr-FR'])).toStrictEqual(['fr-FR', 'fr-FR']);
  });

  it('returns no tags for an empty array', () => {
    expect(parseDeviceLanguageTags([])).toStrictEqual([]);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'fr-FR'],
    ['a number', 42],
    ['an object', {}],
    ['an array-like object', { 0: 'fr-FR', length: 1 }],
  ])('returns no tags when the report is not an array: %s', (_label, input) => {
    expect(parseDeviceLanguageTags(input)).toStrictEqual([]);
  });

  it('never throws, so a malformed report cannot break language resolution', () => {
    expect(deviceLanguageTagsSchema.safeParse(Symbol('tags')).success).toBe(true);
    expect(parseDeviceLanguageTags([Symbol('tag'), 'fr'])).toStrictEqual(['fr']);
  });
});
