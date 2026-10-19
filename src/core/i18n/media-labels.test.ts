import { describe, expect, it } from '@jest/globals';

import { MEDIA_FORMATS, MEDIA_KINDS, MEDIA_STATUSES } from '../domain/media';
import { createI18n } from './create-i18n';
import { formatNumber } from './format';
import type { Language } from './languages';
import {
  englishTitleOf,
  FORMAT_KEYS,
  nativeTitleOf,
  STATUS_KEYS,
  TOTAL_UNITS_LABEL_KEYS,
  YEAR_FORMAT,
} from './media-labels';

const TITLE = 'Sousou no Frieren';

// the translation of the real catalogs in `language`: a missing key fails the test
const translationIn = (language: Language) => {
  const instance = createI18n({
    language,
    onMissingKey: (missingIn, key) => {
      throw new Error(`missing key ${key} in ${missingIn}`);
    },
  });
  return {
    t: instance.getFixedT(language, 'translation'),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, language, options),
  };
};

describe('englishTitleOf', () => {
  it.each<[string, string | null, string | undefined]>([
    ['a different english title', "Frieren: Beyond Journey's End", "Frieren: Beyond Journey's End"],
    ['the same title in another case', 'sousou no frieren', undefined],
    ['the same title', TITLE, undefined],
    ['no english title', null, undefined],
  ])('gives %s', (_case, titleEnglish, expected) => {
    expect(englishTitleOf({ title: TITLE, titleEnglish })).toBe(expected);
  });
});

describe('nativeTitleOf', () => {
  it.each<[string, string, string | null, string | undefined]>([
    ['a native title in another script', TITLE, '葬送のフリーレン', '葬送のフリーレン'],
    ['the same title', 'Berserk', 'Berserk', undefined],
    // unlike the english title: a case difference in a native title is kept
    ['the same title in another case', 'Berserk', 'BERSERK', 'BERSERK'],
    ['no native title', TITLE, null, undefined],
  ])('gives %s', (_case, title, titleNative, expected) => {
    expect(nativeTitleOf({ title, titleNative })).toBe(expected);
  });
});

describe('media label keys', () => {
  it('names an ongoing anime airing and an ongoing manga publishing', () => {
    const en = translationIn('en');
    const fr = translationIn('fr');

    expect(en.t(STATUS_KEYS.anime.ongoing)).toBe('Airing');
    expect(en.t(STATUS_KEYS.manga.ongoing)).toBe('Publishing');
    expect(fr.t(STATUS_KEYS.anime.ongoing)).toBe('En cours de diffusion');
    expect(fr.t(STATUS_KEYS.manga.ongoing)).toBe('En cours de publication');
  });

  it.each(MEDIA_KINDS)('translates every status of a %s', (kind) => {
    const { t } = translationIn('en');

    for (const status of MEDIA_STATUSES) {
      expect(t(STATUS_KEYS[kind][status])).not.toBe(STATUS_KEYS[kind][status]);
    }
  });

  it('translates every format', () => {
    const { t } = translationIn('en');

    for (const format of MEDIA_FORMATS) {
      expect(t(FORMAT_KEYS[format])).not.toBe(FORMAT_KEYS[format]);
    }
  });

  it.each<[(typeof MEDIA_KINDS)[number], string, string]>([
    ['anime', 'Episodes', 'Épisodes'],
    ['manga', 'Chapters', 'Chapitres'],
  ])('labels the total units of a %s', (kind, en, fr) => {
    expect(translationIn('en').t(TOTAL_UNITS_LABEL_KEYS[kind])).toBe(en);
    expect(translationIn('fr').t(TOTAL_UNITS_LABEL_KEYS[kind])).toBe(fr);
  });

  it('writes a year without digit grouping', () => {
    const en = translationIn('en');
    const fr = translationIn('fr');

    expect(en.formatNumber(2023, YEAR_FORMAT)).toBe('2023');
    expect(fr.formatNumber(2023, YEAR_FORMAT)).toBe('2023');
  });
});
