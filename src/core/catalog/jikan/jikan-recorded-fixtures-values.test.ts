import { describe, expect, it } from '@jest/globals';

import { server } from '../../../../test/core/msw-server';
import type { MediaKind } from '../../domain/media';
import type { MediaSummary } from '../catalog-provider';
import {
  RAW_ANIME,
  RAW_ITEMS,
  RAW_MANGA,
  RAW_SEASON_NOW,
  RAW_YEAR_PROBE_BOUNDED,
  rawAnimeOf,
  rawItemOf,
  rawUnitsOf,
} from './__fixtures__/tenrai-raw';
import {
  GENRE_RECORDINGS,
  PAGE_RECORDINGS,
  YEAR_PROBE_YEAR,
  fetchAllSummaries,
  fetchRecorded,
  summaryOf,
} from './__fixtures__/tenrai-recordings';

// the recorded tenrai responses through the provider (see jikan-recorded-fixtures.test.ts):
// scores and unit counts, covers, the year probe, the current season list and the genre lists,
// each checked on the raw json and on the mapped output

const MAL_CDN = 'https://cdn.myanimelist.net/';
const ONE_PIECE_ID = 21;
const EARLIER_SEASON_ID = 61469;
const SHARED_GENRE_ID = 41;

describe('scores and unit counts', () => {
  it('map as recorded, a null score or count to null', async () => {
    const summaries = await fetchAllSummaries(server);

    expect(summaries.map(({ score, totalUnits }) => ({ score, totalUnits }))).toStrictEqual(
      summaries.map(({ key }) => ({
        score: rawItemOf(key.kind, key.externalId).score,
        totalUnits: rawUnitsOf(key.kind, key.externalId),
      })),
    );
  });

  it.each<[string, MediaKind, number, 'score' | 'totalUnits']>([
    ['a null score', 'anime', 63816, 'score'],
    ['a null episode count', 'anime', 63816, 'totalUnits'],
    ['a null episode count while airing', 'anime', EARLIER_SEASON_ID, 'totalUnits'],
    ['a null chapter count', 'manga', 2, 'totalUnits'],
    ['a null chapter count', 'manga', 172429, 'totalUnits'],
  ])('hold %s (%s %d)', async (_, kind, malId, field) => {
    const summary = summaryOf(await fetchAllSummaries(server), kind, malId);
    const raw = field === 'score' ? rawItemOf(kind, malId).score : rawUnitsOf(kind, malId);

    expect(raw).toBeNull();
    expect(summary).toHaveProperty(field, null);
  });
});

describe('covers', () => {
  it('are recorded on the mal cdn over https', () => {
    const urls = RAW_ITEMS.flatMap(({ item }) =>
      [item.images.jpg, item.images.webp].flatMap((variant) => [
        variant.image_url,
        variant.large_image_url,
      ]),
    );

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((url) => !url.startsWith(MAL_CDN))).toStrictEqual([]);
  });

  it('are kept as the large webp image of every summary', async () => {
    const summaries = await fetchAllSummaries(server);

    expect(summaries.map(({ imageUrl }) => imageUrl)).toStrictEqual(
      summaries.map(({ key }) => rawItemOf(key.kind, key.externalId).images.webp.large_image_url),
    );
    expect(summaries.filter(({ imageUrl }) => !imageUrl?.startsWith(MAL_CDN))).toStrictEqual([]);
  });
});

describe('the year probe', () => {
  it('finds nothing within the year: end_date bounds the end of airing', async () => {
    const { result, urls } = await fetchRecorded(server, PAGE_RECORDINGS.yearProbeBounded);
    const year = String(YEAR_PROBE_YEAR);

    expect(RAW_YEAR_PROBE_BOUNDED).toStrictEqual([]);
    // the adapter's year filter sends the bounded probe
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`&start_date=${year}-01-01&end_date=${year}-12-31&`);
    expect(result).toMatchObject({ items: [], hasNextPage: false });
  });

  it('lists one piece, airing since 1999, from the start of the year alone', async () => {
    const { result } = await fetchRecorded(server, PAGE_RECORDINGS.yearProbeOpen);
    const raw = rawAnimeOf(ONE_PIECE_ID);

    expect([raw.status, raw.airing, raw.aired.prop.from.year]).toStrictEqual([
      'Currently Airing',
      true,
      YEAR_PROBE_YEAR,
    ]);
    expect(RAW_ANIME.filter(({ item }) => item.mal_id === ONE_PIECE_ID)).toStrictEqual([
      { file: 'year-probe-open.json', item: raw },
    ]);
    expect(summaryOf(result.items, 'anime', ONE_PIECE_ID)).toMatchObject({
      title: 'One Piece',
      status: 'ongoing',
      totalUnits: null,
      year: YEAR_PROBE_YEAR,
    } satisfies Partial<MediaSummary>);
  });
});

describe('the current season list', () => {
  // raw data only: whether discovery keeps such a title is decided by C-08, the adapter keeps it
  it('holds a title of an earlier season, still airing', () => {
    const earlier = RAW_SEASON_NOW.find(({ mal_id }) => mal_id === EARLIER_SEASON_ID);

    expect([earlier?.season, earlier?.status, earlier?.airing]).toStrictEqual([
      'winter',
      'Currently Airing',
      true,
    ]);
    expect(RAW_SEASON_NOW.filter(({ season }) => season !== 'fall')).toHaveLength(1);
  });
});

describe('genre lists', () => {
  it.each(['anime', 'manga'] as const)('parse the %s list to unique ids', async (kind) => {
    const { result } = await fetchRecorded(server, GENRE_RECORDINGS[kind]);
    const ids = result.map(({ id }) => id);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scope ids by kind: anime genre 41 is not manga genre 41', async () => {
    const anime = (await fetchRecorded(server, GENRE_RECORDINGS.anime)).result;
    const manga = (await fetchRecorded(server, GENRE_RECORDINGS.manga)).result;

    expect([
      anime.find(({ id }) => id === SHARED_GENRE_ID)?.name,
      manga.find(({ id }) => id === SHARED_GENRE_ID)?.name,
    ]).toStrictEqual(['Suspense', 'Seinen']);
    // the items agree: genre 41 of an anime is Suspense, of a manga Seinen
    expect(RAW_ANIME.flatMap(({ item }) => item.genres)).toContainEqual(
      expect.objectContaining({ mal_id: SHARED_GENRE_ID, name: 'Suspense' }),
    );
    expect(RAW_MANGA.flatMap(({ item }) => item.demographics)).toContainEqual(
      expect.objectContaining({ mal_id: SHARED_GENRE_ID, name: 'Seinen' }),
    );
  });
});
