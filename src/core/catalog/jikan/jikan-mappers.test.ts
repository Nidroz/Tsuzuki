import { describe, expect, it } from '@jest/globals';

import type { MediaKind } from '../../domain/media';
import { CatalogResponseError } from '../../errors/catalog-errors';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanManga,
  genreRef,
  withoutKeys,
} from './__fixtures__/jikan-builders';
import { parseJikanDetail } from './jikan-mappers';

const CDN = 'https://cdn.myanimelist.net';
const OTHER_HOST = 'https://images.example';

const builderOf = { anime: buildJikanAnime, manga: buildJikanManga } as const;
const defaultIdOf = { anime: 101, manga: 201 } as const;

// the detail of one built item of `kind`, with `overrides` on top of the builder's defaults
const detailOf = (kind: MediaKind, overrides: Record<string, unknown> = {}) =>
  parseJikanDetail(
    { kind, malId: defaultIdOf[kind] },
    buildJikanDetail(builderOf[kind](overrides)),
  );

// the error thrown by `parse`, or null
const failureOf = (parse: () => unknown): unknown => {
  try {
    parse();
  } catch (error: unknown) {
    return error;
  }
  return null;
};

describe('BR-06 isAdult', () => {
  it('flags an anime rated Rx - Hentai with clean genres', () => {
    expect(detailOf('anime', { rating: 'Rx - Hentai' }).isAdult).toBe(true);
  });

  it.each([
    [' rx - hentai ', true],
    ['RX', true],
    ['R+ - Mild Nudity', false],
    ['R - 17+ (violence & profanity)', false],
    [null, false],
  ])('reads the anime rating %p as adult: %p', (rating, isAdult) => {
    expect(detailOf('anime', { rating }).isAdult).toBe(isAdult);
  });

  it('flags Hentai found only in explicit_genres', () => {
    const detail = detailOf('anime', { explicit_genres: [genreRef(12, 'Hentai')] });
    expect(detail.isAdult).toBe(true);
    expect(detail.genres).toContainEqual({ id: 12, name: 'Hentai' });
  });

  it('flags Erotica in the explicit_genres of a manga', () => {
    const detail = detailOf('manga', { explicit_genres: [genreRef(49, 'Erotica', 'manga')] });
    expect(detail.isAdult).toBe(true);
  });

  it('keeps a clean title, and ignores a rating sent on a manga', () => {
    expect(detailOf('anime').isAdult).toBe(false);
    expect(detailOf('manga', { rating: 'Rx - Hentai' }).isAdult).toBe(false);
  });

  it('flags an adult name even when its id repeats a clean genre', () => {
    const detail = detailOf('anime', {
      genres: [genreRef(1, 'Action')],
      explicit_genres: [genreRef(1, 'Hentai')],
    });
    expect(detail.isAdult).toBe(true);
  });

  it.each(['genres', 'explicit_genres', 'themes', 'demographics'])(
    'fails the response when %s is missing or malformed',
    (key) => {
      const kinds: MediaKind[] = ['anime', 'manga'];
      for (const kind of kinds) {
        const mediaKey = { kind, malId: defaultIdOf[kind] };
        const body = buildJikanDetail(withoutKeys(builderOf[kind](), key));
        expect(failureOf(() => parseJikanDetail(mediaKey, body))).toBeInstanceOf(
          CatalogResponseError,
        );
      }
    },
  );

  it.each([
    ['null', null],
    ['a genre with id 0', [{ mal_id: 0, name: 'Hentai' }]],
    ['a genre without a name', [{ mal_id: 12 }]],
    ['a genre with a numeric name', [{ mal_id: 12, name: 12 }]],
  ])('fails the response when explicit_genres is %s', (_case, explicitGenres) => {
    const body = buildJikanDetail(buildJikanAnime({ explicit_genres: explicitGenres }));
    expect(failureOf(() => parseJikanDetail({ kind: 'anime', malId: 101 }, body))).toBeInstanceOf(
      CatalogResponseError,
    );
  });

  it.each([
    ['missing', withoutKeys(buildJikanAnime(), 'rating')],
    ['a number', buildJikanAnime({ rating: 18 })],
    ['an object', buildJikanAnime({ rating: { code: 'rx' } })],
  ])('fails an anime response when the rating is %s', (_case, item) => {
    expect(
      failureOf(() => parseJikanDetail({ kind: 'anime', malId: 101 }, buildJikanDetail(item))),
    ).toBeInstanceOf(CatalogResponseError);
  });
});

describe('genres', () => {
  it('lists genres, explicit genres, themes and demographics in order, each id once', () => {
    const detail = detailOf('anime', {
      genres: [genreRef(1, 'Action'), genreRef(4, 'Comedy')],
      explicit_genres: [genreRef(9, 'Ecchi'), genreRef(1, 'Action')],
      themes: [genreRef(23, 'School')],
      demographics: [genreRef(27, 'Shounen'), genreRef(23, 'School')],
    });
    expect(detail.genres).toStrictEqual([
      { id: 1, name: 'Action' },
      { id: 4, name: 'Comedy' },
      { id: 9, name: 'Ecchi' },
      { id: 23, name: 'School' },
      { id: 27, name: 'Shounen' },
    ]);
  });
});

describe('cover image', () => {
  const variant = (base: string) => ({
    image_url: `${base}/images/anime/1/101.jpg`,
    large_image_url: `${base}/images/anime/1/101l.jpg`,
  });

  it('prefers the large webp, then the large jpg, then the jpg', () => {
    const webp = { image_url: `${CDN}/images/anime/1/101.webp`, large_image_url: `${CDN}/w.webp` };
    expect(detailOf('anime', { images: { jpg: variant(CDN), webp } }).imageUrl).toBe(
      `${CDN}/w.webp`,
    );
    expect(
      detailOf('anime', { images: { jpg: variant(CDN), webp: variant(OTHER_HOST) } }).imageUrl,
    ).toBe(`${CDN}/images/anime/1/101l.jpg`);
    expect(
      detailOf('anime', {
        images: {
          jpg: { ...variant(CDN), large_image_url: `${OTHER_HOST}/x.jpg` },
          webp: { large_image_url: null },
        },
      }).imageUrl,
    ).toBe(`${CDN}/images/anime/1/101.jpg`);
  });

  it.each([
    ['every candidate on another host', { jpg: variant(OTHER_HOST), webp: variant(OTHER_HOST) }],
    ['only a small image', { jpg: { small_image_url: `${CDN}/images/anime/1/101t.jpg` } }],
    ['malformed variants', { jpg: 'x', webp: [] }],
    ['images set to null', null],
  ])('gives no cover with %s', (_case, images) => {
    expect(detailOf('anime', { images }).imageUrl).toBeNull();
  });

  it('gives no cover without an images key', () => {
    const body = buildJikanDetail(withoutKeys(buildJikanManga(), 'images'));
    expect(parseJikanDetail({ kind: 'manga', malId: 201 }, body).imageUrl).toBeNull();
  });
});

describe('parseJikanDetail', () => {
  it('maps a whole anime and strips every other field', () => {
    expect(detailOf('anime')).toStrictEqual({
      key: { kind: 'anime', malId: 101 },
      title: 'Sample Anime',
      titleEnglish: 'Sample Anime in English',
      imageUrl: `${CDN}/images/anime/1/101l.webp`,
      format: 'tv',
      status: 'finished',
      totalUnits: 12,
      score: 7.5,
      year: 2020,
      genres: [
        { id: 1, name: 'Action' },
        { id: 4, name: 'Comedy' },
        { id: 23, name: 'School' },
        { id: 27, name: 'Shounen' },
      ],
      isAdult: false,
      synopsis: 'synopsis placeholder',
      titleNative: 'サンプルアニメ',
    });
  });

  it('maps a whole manga', () => {
    expect(detailOf('manga')).toStrictEqual({
      key: { kind: 'manga', malId: 201 },
      title: 'Sample Manga',
      titleEnglish: 'Sample Manga in English',
      imageUrl: `${CDN}/images/manga/1/201l.webp`,
      format: 'manga',
      status: 'finished',
      totalUnits: 40,
      score: 8.1,
      year: 2015,
      genres: [
        { id: 2, name: 'Adventure' },
        { id: 42, name: 'Seinen' },
      ],
      isAdult: false,
      synopsis: 'synopsis placeholder',
      titleNative: 'サンプル漫画',
    });
  });

  it('fails when the item is not the requested one', () => {
    const body = buildJikanDetail(buildJikanAnime({ mal_id: 102 }));
    expect(failureOf(() => parseJikanDetail({ kind: 'anime', malId: 101 }, body))).toBeInstanceOf(
      CatalogResponseError,
    );
  });

  it.each([null, 'text', {}, { data: null }, { data: [buildJikanAnime()] }])(
    'fails the envelope %p',
    (body) => {
      expect(failureOf(() => parseJikanDetail({ kind: 'anime', malId: 101 }, body))).toBeInstanceOf(
        CatalogResponseError,
      );
    },
  );

  it('reports a failure without any detail, cause or provider text', () => {
    const failure = failureOf(() =>
      parseJikanDetail({ kind: 'anime', malId: 101 }, { data: { mal_id: 'Sample Anime' } }),
    );
    expect(failure).toBeInstanceOf(CatalogResponseError);
    expect(Object.getOwnPropertyNames(failure).sort()).toStrictEqual(['message', 'name', 'stack']);
    expect(String(failure)).not.toContain('Sample');
  });
});
