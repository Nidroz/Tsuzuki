import { describe, expect, it, jest } from '@jest/globals';

import { server } from '../../../../test/core/msw-server';
import type { MediaKind, SearchableMediaFormat } from '../../domain/media';
import type { CatalogProvider, TopParams } from '../catalog-provider';
import { buildJikanAnime, buildJikanManga, buildJikanPage } from './__fixtures__/jikan-builders';
import { TENRAI_BASE, jikanHandler, jsonAnswer } from './__fixtures__/jikan-handlers';
import { createJikanCatalogProvider } from './jikan-catalog-provider';
import { TENRAI_INSTANCE } from './jikan-instances';

// the top list of a kind, filtered by one format (C-08, FR-05): the format becomes the jikan search
// type of `/top/{kind}`, never a content filter. the request priority is in
// jikan-catalog-provider-priority.test.ts, the endpoint matrix in jikan-catalog-provider.test.ts

// longer than any token wait of the tenrai policy
const LONG_AFTER_MS = 10_000;

// out-of-contract formats, as a caller bypassing the types would pass them
const asFormat = (value: string): SearchableMediaFormat => value as SearchableMediaFormat;

const createProvider = (): CatalogProvider => createJikanCatalogProvider(TENRAI_INSTANCE);

// answers every request of the top list of `kind` with one item, and returns its urls
const serveTop = (kind: MediaKind): (() => string[]) => {
  const item = kind === 'anime' ? buildJikanAnime() : buildJikanManga({ type: 'Manhwa' });
  const { handler, requests } = jikanHandler(`/top/${kind}`, jsonAnswer(buildJikanPage([item])));
  server.use(handler);
  return () => requests.map(({ url }) => url);
};

describe('getTop with a format', () => {
  it('sends the manga search type before the pagination', async () => {
    const urls = serveTop('manga');

    const page = await createProvider().getTop({ kind: 'manga', format: 'manhwa', page: 2 });

    expect(urls()).toStrictEqual([`${TENRAI_BASE}/top/manga?type=manhwa&page=2&limit=25`]);
    expect(page.page).toBe(2);
    expect(page.items.map(({ key, format }) => ({ key, format }))).toStrictEqual([
      { key: { namespace: 'mal', kind: 'manga', externalId: 201 }, format: 'manhwa' },
    ]);
  });

  it.each<[SearchableMediaFormat, string]>([
    ['light_novel', 'lightnovel'],
    ['one_shot', 'oneshot'],
  ])('sends the manga format %p as the type %p', async (format, type) => {
    const urls = serveTop('manga');

    await createProvider().getTop({ kind: 'manga', format, page: 1 });

    expect(urls()).toStrictEqual([`${TENRAI_BASE}/top/manga?type=${type}&page=1&limit=25`]);
  });

  it('sends an anime format as its type', async () => {
    const urls = serveTop('anime');

    await createProvider().getTop({ kind: 'anime', format: 'movie', page: 1 });

    expect(urls()).toStrictEqual([`${TENRAI_BASE}/top/anime?type=movie&page=1&limit=25`]);
  });
});

describe('getTop without a format', () => {
  it('sends no type: every format of the kind', async () => {
    const urls = serveTop('manga');

    await createProvider().getTop({ kind: 'manga', page: 1 });

    expect(urls()).toStrictEqual([`${TENRAI_BASE}/top/manga?page=1&limit=25`]);
  });
});

describe('getTop with a format it cannot send', () => {
  it.each<[string, TopParams]>([
    ['an anime format on top manga', { kind: 'manga', format: 'tv', page: 1 }],
    ['a manga format on top anime', { kind: 'anime', format: 'manhwa', page: 1 }],
    ['oel, without a provider type', { kind: 'manga', format: asFormat('oel'), page: 1 }],
    ['unknown, without a provider type', { kind: 'anime', format: asFormat('unknown'), page: 1 }],
  ])('rejects %s with a RangeError and sends nothing', async (_, params) => {
    const urls = serveTop(params.kind);

    const outcome = createProvider()
      .getTop(params)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);

    expect(await outcome).toBeInstanceOf(RangeError);
    expect(urls()).toStrictEqual([]);
  });
});
