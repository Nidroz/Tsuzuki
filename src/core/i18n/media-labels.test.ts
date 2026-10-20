import { describe, expect, it } from '@jest/globals';

import { LIBRARY_STATUSES } from '../domain/library-entry';
import { MEDIA_FORMATS, MEDIA_KINDS, MEDIA_STATUSES } from '../domain/media';
import { createI18n } from './create-i18n';
import { formatNumber } from './format';
import type { Language } from './languages';
import {
  englishTitleOf,
  FORMAT_KEYS,
  LIBRARY_STATUS_KEYS,
  nativeTitleOf,
  PROGRESS_LABEL_KEYS,
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

describe('library label keys', () => {
  it('names a current anime watched and a current manga read (FR-11)', () => {
    const en = translationIn('en');
    const fr = translationIn('fr');

    expect(en.t(LIBRARY_STATUS_KEYS.anime.current)).toBe('Watching');
    expect(en.t(LIBRARY_STATUS_KEYS.manga.current)).toBe('Reading');
    expect(en.t(LIBRARY_STATUS_KEYS.anime.planned)).toBe('Plan to watch');
    expect(en.t(LIBRARY_STATUS_KEYS.manga.planned)).toBe('Plan to read');
    expect(fr.t(LIBRARY_STATUS_KEYS.anime.current)).toBe('En cours de visionnage');
    expect(fr.t(LIBRARY_STATUS_KEYS.manga.current)).toBe('En cours de lecture');
  });

  it.each(MEDIA_KINDS)('translates every library status of a %s', (kind) => {
    const { t } = translationIn('en');

    for (const status of LIBRARY_STATUSES) {
      expect(t(LIBRARY_STATUS_KEYS[kind][status])).not.toBe(LIBRARY_STATUS_KEYS[kind][status]);
    }
  });

  it.each<[(typeof MEDIA_KINDS)[number], string, string, string, string]>([
    ['anime', '12 / 28 episodes', '0 / 1 episode', '12 episodes', '1 episode'],
    ['manga', '12 / 28 chapters', '0 / 1 chapter', '12 chapters', '1 chapter'],
  ])('writes the progress of a %s, with its total or alone', (kind, many, one, alone, aloneOne) => {
    const { t } = translationIn('en');
    const keys = PROGRESS_LABEL_KEYS[kind];

    expect(t(keys.ofTotal, { progress: '12', total: '28', count: 28 })).toBe(many);
    expect(t(keys.ofTotal, { progress: '0', total: '1', count: 1 })).toBe(one);
    expect(t(keys.alone, { progress: '12', count: 12 })).toBe(alone);
    expect(t(keys.alone, { progress: '1', count: 1 })).toBe(aloneOne);
  });

  it('writes a french progress in the singular for 0 and 1', () => {
    const { t } = translationIn('fr');

    expect(t(PROGRESS_LABEL_KEYS.anime.alone, { progress: '0', count: 0 })).toBe('0 épisode');
    expect(t(PROGRESS_LABEL_KEYS.manga.ofTotal, { progress: '3', total: '201', count: 201 })).toBe(
      '3 / 201 chapitres',
    );
  });

  it.each<[(typeof MEDIA_KINDS)[number], string, string]>([
    ['anime', 'Add one episode', 'Episodes watched'],
    ['manga', 'Add one chapter', 'Chapters read'],
  ])('labels the +1 button and the progress field of a %s', (kind, increment, field) => {
    const { t } = translationIn('en');

    expect(t(PROGRESS_LABEL_KEYS[kind].increment)).toBe(increment);
    expect(t(PROGRESS_LABEL_KEYS[kind].field)).toBe(field);
  });
});
