import { describe, expect, it } from '@jest/globals';

import { server } from '../../../../test/core/msw-server';
import type { MediaKind } from '../../domain/media';
import { TENRAI_BASE } from './__fixtures__/jikan-handlers';
import {
  RAW_ANIME,
  RAW_GENRES,
  RAW_ITEMS,
  RAW_MANGA,
  rawIdsOf,
  rawItemOf,
  rawTitleOf,
} from './__fixtures__/tenrai-raw';
import {
  DETAIL_RECORDINGS,
  GENRE_RECORDINGS,
  PAGE_RECORDINGS,
  fetchAllSummaries,
  fetchRecorded,
  summaryOf,
} from './__fixtures__/tenrai-recordings';
import { JIKAN_ANIME_STATUSES } from './jikan-fields';

// every recorded tenrai response (__fixtures__/tenrai/) through the provider, msw on the tenrai
// urls, and the facts the adapter relies on (docs/ARCHITECTURE.md §3, ADR-0013), each checked on
// the raw json and on the mapped output: types, titles, statuses and the BR-06 inputs here, the
// other values in jikan-recorded-fixtures-values.test.ts

const GENRE_ARRAYS = ['genres', 'explicit_genres', 'themes', 'demographics'] as const;
const EARLIER_SEASON_ID = 61469;
const RX_PREFIX = 'Rx';

describe('every recorded response', () => {
  it.each(Object.values(PAGE_RECORDINGS))(
    'maps every item of $file, in order, from one request',
    async (recording) => {
      const { result, urls } = await fetchRecorded(server, recording);

      expect(result.items.map(({ key }) => key.externalId)).toStrictEqual(rawIdsOf(recording.file));
      expect(urls).toHaveLength(1);
      expect(urls[0]?.startsWith(`${TENRAI_BASE}${recording.path}?`)).toBe(true);
    },
  );

  it.each(Object.values(DETAIL_RECORDINGS))('maps the detail of $file', async (recording) => {
    const { result, urls } = await fetchRecorded(server, recording);

    expect([result.key.externalId]).toStrictEqual(rawIdsOf(recording.file));
    expect(urls).toStrictEqual([`${TENRAI_BASE}${recording.path}`]);
  });

  it.each(['anime', 'manga'] as const)('maps the %s genre list, in order', async (kind) => {
    const { result } = await fetchRecorded(server, GENRE_RECORDINGS[kind]);

    expect(result).toStrictEqual(
      RAW_GENRES[kind].map(({ mal_id, name }) => ({ id: mal_id, name })),
    );
  });
});

describe('type values', () => {
  it('are capitalized as documented', () => {
    expect(new Set(RAW_ANIME.map(({ item }) => item.type))).toStrictEqual(
      new Set(['TV', 'ONA', 'Movie', 'Special']),
    );
    expect(new Set(RAW_MANGA.map(({ item }) => item.type))).toStrictEqual(
      new Set(['Manhwa', 'Manga', 'Novel']),
    );
  });

  it.each<[string, MediaKind, number, string]>([
    ['tv', 'anime', 52991, 'TV'],
    ['ona', 'anime', 56885, 'ONA'],
    ['movie', 'anime', 54250, 'Movie'],
    ['manhwa', 'manga', 121496, 'Manhwa'],
    ['manga', 'manga', 2, 'Manga'],
    ['novel', 'manga', 162032, 'Novel'],
  ])('map to the %s format (%s %d, %s)', async (format, kind, malId, rawType) => {
    const summary = summaryOf(await fetchAllSummaries(server), kind, malId);

    expect(rawItemOf(kind, malId).type).toBe(rawType);
    expect(summary?.format).toBe(format);
  });
});

describe('titles', () => {
  it('hold one Default entry per item, and Japanese and English entries', () => {
    const types = new Set(RAW_ITEMS.flatMap(({ item }) => item.titles.map(({ type }) => type)));
    const defaultCounts = RAW_ITEMS.map(
      ({ item }) => item.titles.filter(({ type }) => type === 'Default').length,
    );

    expect([...types]).toStrictEqual(
      expect.arrayContaining(['Default', 'Japanese', 'English', 'Synonym']),
    );
    expect(new Set(defaultCounts)).toStrictEqual(new Set([1]));
  });

  it('give the title and English title of every summary', async () => {
    const summaries = await fetchAllSummaries(server);

    expect(summaries.map(({ title, titleEnglish }) => ({ title, titleEnglish }))).toStrictEqual(
      summaries.map(({ key }) => ({
        title: rawTitleOf(rawItemOf(key.kind, key.externalId), 'Default'),
        titleEnglish: rawTitleOf(rawItemOf(key.kind, key.externalId), 'English'),
      })),
    );
    // no English entry and no title_english: no English title
    expect(rawItemOf('anime', 54250).title_english).toBeNull();
    expect(summaryOf(summaries, 'anime', 54250)?.titleEnglish).toBeNull();
  });

  it.each(Object.values(DETAIL_RECORDINGS))(
    'give the three titles of the $file detail',
    async (recording) => {
      const { result } = await fetchRecorded(server, recording);
      const raw = rawItemOf(result.key.kind, result.key.externalId);

      expect([result.title, result.titleEnglish, result.titleNative]).toStrictEqual([
        rawTitleOf(raw, 'Default'),
        rawTitleOf(raw, 'English'),
        rawTitleOf(raw, 'Japanese'),
      ]);
    },
  );

  it('read the Japanese entry as the native title, whatever its language', async () => {
    const { result } = await fetchRecorded(server, DETAIL_RECORDINGS.manga121496);

    // a manhwa: its Japanese entry holds the korean title
    expect(result.titleNative).toBe('나 혼자만 레벨업');
  });
});

describe('statuses', () => {
  it('are never null for anime, and documented', () => {
    const statuses = RAW_ANIME.map(({ item }) => item.status);

    expect(statuses).not.toContain(null);
    expect(new Set(statuses)).toStrictEqual(new Set<string>(JIKAN_ANIME_STATUSES));
  });

  it.each<[string, MediaKind, number, string]>([
    ['finished', 'anime', 52991, 'Finished Airing'],
    ['ongoing', 'anime', EARLIER_SEASON_ID, 'Currently Airing'],
    ['upcoming', 'anime', 63816, 'Not yet aired'],
    ['hiatus', 'manga', 656, 'On Hiatus'],
    ['ongoing', 'manga', 2, 'Publishing'],
  ])('map to %s (%s %d, %s)', async (status, kind, malId, rawStatus) => {
    const summary = summaryOf(await fetchAllSummaries(server), kind, malId);

    expect(rawItemOf(kind, malId).status).toBe(rawStatus);
    expect(summary?.status).toBe(status);
  });
});

describe('BR-06 inputs', () => {
  it('every item carries the four genre arrays, and every anime its rating key', () => {
    const missing = RAW_ITEMS.flatMap(({ file, item }) =>
      GENRE_ARRAYS.filter((key) => !Object.hasOwn(item, key) || !Array.isArray(item[key])).map(
        (key) => `${file} ${String(item.mal_id)} ${key}`,
      ),
    );

    expect(missing).toStrictEqual([]);
    expect(RAW_ANIME.filter(({ item }) => !Object.hasOwn(item, 'rating'))).toStrictEqual([]);
    expect(RAW_MANGA.filter(({ item }) => Object.hasOwn(item, 'rating'))).toStrictEqual([]);
  });

  it('every summary lists the four arrays as its genres, in order', async () => {
    const summaries = await fetchAllSummaries(server);

    expect(summaries.map(({ genres }) => genres)).toStrictEqual(
      summaries.map(({ key }) => {
        const raw = rawItemOf(key.kind, key.externalId);
        return GENRE_ARRAYS.flatMap((array) => raw[array]).map(({ mal_id, name }) => ({
          id: mal_id,
          name,
        }));
      }),
    );
  });

  it('no recorded item is adult, raw or mapped', async () => {
    const summaries = await fetchAllSummaries(server);

    expect(RAW_ITEMS.flatMap(({ item }) => item.explicit_genres)).toStrictEqual([]);
    expect(RAW_ANIME.filter(({ item }) => item.rating?.startsWith(RX_PREFIX))).toStrictEqual([]);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.filter(({ isAdult }) => isAdult)).toStrictEqual([]);
  });
});
