import { MEDIA_FORMATS, MEDIA_KINDS, MEDIA_STATUSES } from '@core/domain/media';
import { useTranslation, type Language } from '@core/i18n/index';
import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { providersFor } from '../../../test/mobile/render-with-providers';
import {
  englishTitleOf,
  FORMAT_KEYS,
  nativeTitleOf,
  STATUS_KEYS,
  TOTAL_UNITS_KEYS,
  YEAR_FORMAT,
} from './media-labels';

const TITLE = 'Sousou no Frieren';

// the translation of the real catalogs in `language`: a missing key fails the test
const translationIn = async (language: Language) => {
  const { result } = await renderHook(() => useTranslation(), {
    wrapper: providersFor({ language }),
  });
  return result.current;
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
  it('names an ongoing anime airing and an ongoing manga publishing', async () => {
    const en = await translationIn('en');
    const fr = await translationIn('fr');

    expect(en.t(STATUS_KEYS.anime.ongoing)).toBe('Airing');
    expect(en.t(STATUS_KEYS.manga.ongoing)).toBe('Publishing');
    expect(fr.t(STATUS_KEYS.anime.ongoing)).toBe('En cours de diffusion');
    expect(fr.t(STATUS_KEYS.manga.ongoing)).toBe('En cours de publication');
  });

  it.each(MEDIA_KINDS)('translates every status of a %s', async (kind) => {
    const { t } = await translationIn('en');

    for (const status of MEDIA_STATUSES) {
      expect(t(STATUS_KEYS[kind][status])).not.toBe(STATUS_KEYS[kind][status]);
    }
  });

  it('translates every format', async () => {
    const { t } = await translationIn('en');

    for (const format of MEDIA_FORMATS) {
      expect(t(FORMAT_KEYS[format])).not.toBe(FORMAT_KEYS[format]);
    }
  });

  it.each<[(typeof MEDIA_KINDS)[number], string, string]>([
    ['anime', '1 episode', '12 episodes'],
    ['manga', '1 chapter', '12 chapters'],
  ])('counts the units of a %s in the singular and the plural', async (kind, one, many) => {
    const { t } = await translationIn('en');

    expect(t(TOTAL_UNITS_KEYS[kind], { count: 1, total: '1' })).toBe(one);
    expect(t(TOTAL_UNITS_KEYS[kind], { count: 12, total: '12' })).toBe(many);
  });

  it('writes a year without digit grouping', async () => {
    const en = await translationIn('en');
    const fr = await translationIn('fr');

    expect(en.formatNumber(2023, YEAR_FORMAT)).toBe('2023');
    expect(fr.formatNumber(2023, YEAR_FORMAT)).toBe('2023');
  });
});
