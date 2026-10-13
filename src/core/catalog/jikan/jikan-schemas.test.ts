import { describe, expect, it } from '@jest/globals';

import { MAL_ID_MAX } from '../../domain/media';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanManga,
  withoutKeys,
} from './__fixtures__/jikan-builders';
import { jikanAnimeDetailSchema, jikanMangaDetailSchema } from './jikan-schemas';

// the normalized entry of one item, or null when the item fails its schema
const animeEntry = (item: Record<string, unknown>) => {
  const result = jikanAnimeDetailSchema.safeParse(buildJikanDetail(item));
  return result.success ? result.data.data : null;
};
const mangaEntry = (item: Record<string, unknown>) => {
  const result = jikanMangaDetailSchema.safeParse(buildJikanDetail(item));
  return result.success ? result.data.data : null;
};

const titles = (...entries: readonly (readonly [type: string, title: string])[]) =>
  entries.map(([type, title]) => ({ type, title }));

describe('identity', () => {
  it.each([1, 101, MAL_ID_MAX])('accepts the id %p', (malId) => {
    expect(animeEntry(buildJikanAnime({ mal_id: malId }))?.malId).toBe(malId);
  });

  it.each([0, -1, 1.5, MAL_ID_MAX + 1, '101', null])('fails the id %p', (malId) => {
    expect(animeEntry(buildJikanAnime({ mal_id: malId }))).toBeNull();
    expect(mangaEntry(buildJikanManga({ mal_id: malId }))).toBeNull();
  });
});

describe('format', () => {
  it.each([
    ['TV', 'tv'],
    ['OVA', 'ova'],
    ['Movie', 'movie'],
    ['Special', 'special'],
    ['TV Special', 'special'],
    ['ONA', 'ona'],
    ['Music', 'music'],
    ['CM', 'unknown'],
    ['PV', 'unknown'],
    [null, 'unknown'],
    ['tv', 'unknown'],
    ['constructor', 'unknown'],
    [7, 'unknown'],
  ])('maps the anime type %p to %s', (type, format) => {
    expect(animeEntry(buildJikanAnime({ type }))?.format).toBe(format);
  });

  it.each([
    ['Manga', 'manga'],
    ['Manhwa', 'manhwa'],
    ['Manhua', 'manhua'],
    ['Novel', 'novel'],
    ['Light Novel', 'light_novel'],
    ['One-shot', 'one_shot'],
    ['Doujinshi', 'doujinshi'],
    ['OEL', 'oel'],
    ['TV', 'unknown'],
    [null, 'unknown'],
  ])('maps the manga type %p to %s', (type, format) => {
    expect(mangaEntry(buildJikanManga({ type }))?.format).toBe(format);
  });

  it('reads a missing type as unknown', () => {
    expect(mangaEntry(withoutKeys(buildJikanManga(), 'type'))?.format).toBe('unknown');
  });
});

describe('status', () => {
  it.each([
    ['Finished Airing', 'finished'],
    ['Currently Airing', 'ongoing'],
    ['Not yet aired', 'upcoming'],
  ])('maps the anime status %s to %s', (status, expected) => {
    expect(animeEntry(buildJikanAnime({ status }))?.status).toBe(expected);
  });

  it.each([
    ['Finished', 'finished'],
    ['Publishing', 'ongoing'],
    ['On Hiatus', 'hiatus'],
    ['Discontinued', 'discontinued'],
    ['Not yet published', 'upcoming'],
  ])('maps the manga status %s to %s', (status, expected) => {
    expect(mangaEntry(buildJikanManga({ status }))?.status).toBe(expected);
  });

  it.each([null, 'Airing', 'Publishing', 'finished airing', 'constructor'])(
    'fails the anime status %p',
    (status) => {
      expect(animeEntry(buildJikanAnime({ status }))).toBeNull();
    },
  );

  it('fails a missing status or an anime status on a manga', () => {
    expect(mangaEntry(withoutKeys(buildJikanManga(), 'status'))).toBeNull();
    expect(mangaEntry(buildJikanManga({ status: 'Currently Airing' }))).toBeNull();
  });
});

describe('unit counts and score', () => {
  it.each([
    [12, 12],
    [2_147_483_647, 2_147_483_647],
    [0, null],
    [-1, null],
    [1.5, null],
    [2_147_483_648, null],
    ['12', null],
    [null, null],
  ])('reads %p episodes as %p', (episodes, totalUnits) => {
    expect(animeEntry(buildJikanAnime({ episodes }))?.totalUnits).toBe(totalUnits);
  });

  it('reads the manga chapters, 0 as unknown', () => {
    expect(mangaEntry(buildJikanManga({ chapters: 120 }))?.totalUnits).toBe(120);
    expect(mangaEntry(buildJikanManga({ chapters: 0 }))?.totalUnits).toBeNull();
    expect(mangaEntry(withoutKeys(buildJikanManga(), 'chapters'))?.totalUnits).toBeNull();
  });

  it.each([
    [8.75, 8.75],
    [10, 10],
    [0.01, 0.01],
    [0, null],
    [10.01, null],
    [-2, null],
    ['8', null],
    [null, null],
  ])('reads the score %p as %p', (score, expected) => {
    expect(animeEntry(buildJikanAnime({ score }))?.score).toBe(expected);
  });
});

describe('year', () => {
  const aired = (year: unknown) => ({ from: null, to: null, prop: { from: { year } } });

  it.each([
    ['the anime year first', { year: 2020, aired: aired(2019) }, 2020],
    ['the aired year without a year', { year: null, aired: aired(2019) }, 2019],
    ['the aired year after an invalid year', { year: 99, aired: aired(2019) }, 2019],
    ['null without either', { year: null, aired: aired(null) }, null],
    ['null for an invalid aired year', { year: null, aired: aired(20_190) }, null],
    ['null for a malformed aired', { year: null, aired: { prop: null } }, null],
    ['null without aired', { year: null, aired: undefined }, null],
  ])('reads %s', (_case, overrides, year) => {
    expect(animeEntry(buildJikanAnime(overrides))?.year).toBe(year);
  });

  it('reads the manga start year from published', () => {
    expect(mangaEntry(buildJikanManga())?.year).toBe(2015);
    expect(mangaEntry(withoutKeys(buildJikanManga(), 'published'))?.year).toBeNull();
  });
});

describe('titles', () => {
  it('reads the Default, English and Japanese entries first, trimmed', () => {
    const entry = animeEntry(
      buildJikanAnime({
        titles: titles(
          ['Synonym', 'Other'],
          ['Default', '  Main Title '],
          ['English', 'English Title'],
          ['Japanese', 'Native Title'],
        ),
        title: 'Deprecated',
        title_english: 'Deprecated English',
        title_japanese: 'Deprecated Native',
      }),
    );
    expect(entry).toMatchObject({
      title: 'Main Title',
      titleEnglish: 'English Title',
      titleNative: 'Native Title',
    });
  });

  it.each([
    ['without entries', []],
    ['with blank entries', titles(['Default', ' '], ['English', ''], ['Japanese', '\n'])],
    ['with malformed entries', [{ type: 'Default' }, null, { type: 'English', title: 5 }]],
    ['without a titles array', 'Sample'],
  ])('falls back to the deprecated fields %s', (_case, titleEntries) => {
    const entry = animeEntry(
      buildJikanAnime({
        titles: titleEntries,
        title: 'Deprecated',
        title_english: 'Deprecated English',
        title_japanese: 'Deprecated Native',
      }),
    );
    expect(entry).toMatchObject({
      title: 'Deprecated',
      titleEnglish: 'Deprecated English',
      titleNative: 'Deprecated Native',
    });
  });

  it('reads blank or missing optional titles as null', () => {
    const entry = mangaEntry(
      withoutKeys(
        buildJikanManga({ titles: titles(['Default', 'Main']), title_english: '  ' }),
        'title_japanese',
      ),
    );
    expect(entry).toMatchObject({ title: 'Main', titleEnglish: null, titleNative: null });
  });

  it.each([
    ['blank', { titles: titles(['Default', ' ']), title: '' }],
    ['null', { titles: [], title: null }],
    ['only in another language', { titles: titles(['English', 'English Title']), title: ' ' }],
  ])('fails an item whose default title is %s', (_case, overrides) => {
    expect(animeEntry(buildJikanAnime(overrides))).toBeNull();
    expect(mangaEntry(buildJikanManga(overrides))).toBeNull();
  });

  it('fails an item without any title field', () => {
    expect(animeEntry(withoutKeys(buildJikanAnime(), 'titles', 'title'))).toBeNull();
  });
});

describe('synopsis', () => {
  it.each([
    ['synopsis placeholder', 'synopsis placeholder'],
    ['  synopsis placeholder\n\n', 'synopsis placeholder'],
    ['', null],
    [' \n ', null],
    [null, null],
    [42, null],
  ])('reads the synopsis %p as %p', (synopsis, expected) => {
    expect(animeEntry(buildJikanAnime({ synopsis }))?.synopsis).toBe(expected);
  });

  it('reads a missing synopsis as null', () => {
    expect(mangaEntry(withoutKeys(buildJikanManga(), 'synopsis'))?.synopsis).toBeNull();
  });
});
