// the boundary cases of the catalog provider contract suite (catalog-provider-contract.ts,
// docs/ARCHITECTURE.md §3): the longest search text and the most genre ids a provider accepts, and
// the covers it returns, which come only from its image allowlist (§9). provider-agnostic: the
// catalog interface only
import { describe, expect, it } from '@jest/globals';

import type { MediaSummary } from '@core/catalog/catalog-provider';
import { toAllowedImageUrl } from '@core/catalog/image-url';
import { MEDIA_KINDS, type MediaKey, type MediaKind } from '@core/domain/media';

import { PAGE_CASES, SEARCH_ANIME } from './catalog-provider-contract-cases';
import {
  attempt,
  failureOf,
  fetchPage,
  resultOf,
  type CatalogProviderHarness,
  type PageCall,
} from './catalog-provider-contract-support';

// one code unit, so a text of n of them is n utf-16 code units long
const QUERY_UNIT = 'a';

// the genre filters of a search, each limited to searchGenresMax ids on its own
const GENRE_FILTERS = ['genresIncluded', 'genresExcluded'] as const;

// `count` distinct genre ids from 1
const genreIds = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

// the calls answered with covers outside the allowlist: a search of each kind and a top list
const FOREIGN_IMAGE_CALLS: readonly PageCall[] = [
  { method: 'search', kind: 'anime' },
  { method: 'search', kind: 'manga' },
  { method: 'getTop', kind: 'anime' },
];

const imageUrlsOf = (items: readonly MediaSummary[]): readonly (string | null)[] =>
  items.map((item) => item.imageUrl);

// a cover is either absent or a url the allowlist keeps as it is
const disallowedCovers = (
  urls: readonly (string | null)[],
  hosts: readonly string[],
): readonly string[] =>
  urls.filter((url): url is string => url !== null && toAllowedImageUrl(url, hosts) !== url);

/** registers the search text limit, genre limit and cover cases of one provider adapter. */
export const describeCatalogProviderBoundaries = <TRequest>(
  harness: CatalogProviderHarness<TRequest>,
): void => {
  const detailKey = (kind: MediaKind): MediaKey => harness.detailKey(kind);

  describe('search text limit', () => {
    it('is a positive safe integer', () => {
      const { searchQueryMaxLength } = harness.createProvider();

      expect(Number.isSafeInteger(searchQueryMaxLength)).toBe(true);
      expect(searchQueryMaxLength).toBeGreaterThan(0);
    });

    it('sends a search text of exactly that many code units, in one request', async () => {
      harness.serve('page', SEARCH_ANIME);
      const provider = harness.createProvider();
      const query = QUERY_UNIT.repeat(provider.searchQueryMaxLength);

      const page = await resultOf(provider.search({ kind: 'anime', query, page: 1 }));

      expect(page.items.length).toBeGreaterThan(0);
      expect(harness.requests()).toHaveLength(1);
    });

    it('rejects one code unit more with a RangeError, sending nothing', async () => {
      harness.serve('page', SEARCH_ANIME);
      const provider = harness.createProvider();
      const query = QUERY_UNIT.repeat(provider.searchQueryMaxLength + 1);

      const error = await failureOf(
        attempt(() => provider.search({ kind: 'anime', query, page: 1 })),
      );

      expect(error).toBeInstanceOf(RangeError);
      expect(harness.requests()).toHaveLength(0);
    });
  });

  describe('genre limit', () => {
    it('is a positive safe integer', () => {
      const { searchGenresMax } = harness.createProvider();

      expect(Number.isSafeInteger(searchGenresMax)).toBe(true);
      expect(searchGenresMax).toBeGreaterThan(0);
    });

    it.each(GENRE_FILTERS)('sends exactly that many %s ids, in one request', async (filter) => {
      harness.serve('page', SEARCH_ANIME);
      const provider = harness.createProvider();
      const ids = genreIds(provider.searchGenresMax);

      const page = await resultOf(provider.search({ kind: 'anime', [filter]: ids, page: 1 }));

      expect(page.items.length).toBeGreaterThan(0);
      expect(harness.requests()).toHaveLength(1);
    });

    it.each(GENRE_FILTERS)(
      'counts %s ids once deduplicated: one more id that repeats one is sent',
      async (filter) => {
        harness.serve('page', SEARCH_ANIME);
        const provider = harness.createProvider();
        const ids = [...genreIds(provider.searchGenresMax), 1];

        await resultOf(provider.search({ kind: 'anime', [filter]: ids, page: 1 }));

        expect(harness.requests()).toHaveLength(1);
      },
    );

    it.each(GENRE_FILTERS)(
      'rejects one distinct %s id more with a RangeError, sending nothing',
      async (filter) => {
        harness.serve('page', SEARCH_ANIME);
        const provider = harness.createProvider();
        const ids = genreIds(provider.searchGenresMax + 1);

        const error = await failureOf(
          attempt(() => provider.search({ kind: 'anime', [filter]: ids, page: 1 })),
        );

        expect(error).toBeInstanceOf(RangeError);
        expect(harness.requests()).toHaveLength(0);
      },
    );
  });

  describe('covers come only from the image allowlist', () => {
    it('names at least one image host', () => {
      expect(harness.allowedImageHosts.length).toBeGreaterThan(0);
    });

    it('exposes the image allowlist as its image hosts', () => {
      expect(harness.createProvider().imageHosts).toStrictEqual(harness.allowedImageHosts);
    });

    it.each(PAGE_CASES)(
      '$label: every cover is absent or allowed, and some are present',
      async ({ call }) => {
        harness.serve('page', call);

        const { items } = await resultOf(fetchPage(harness.createProvider(), call, 1));
        const urls = imageUrlsOf(items);

        expect(disallowedCovers(urls, harness.allowedImageHosts)).toStrictEqual([]);
        expect(urls.some((url) => url !== null)).toBe(true);
      },
    );

    it.each(MEDIA_KINDS)('%s detail: its cover is allowed and present', async (kind) => {
      harness.serve('detail', { method: 'getDetail', kind });

      const detail = await resultOf(harness.createProvider().getDetail(detailKey(kind)));

      expect(detail.imageUrl).not.toBeNull();
      expect(disallowedCovers([detail.imageUrl], harness.allowedImageHosts)).toStrictEqual([]);
    });

    it.each(FOREIGN_IMAGE_CALLS)(
      '$method $kind: covers on another host or over http are dropped',
      async (call) => {
        harness.serve('foreign-image', call);

        const { items } = await resultOf(fetchPage(harness.createProvider(), call, 1));

        expect(items.length).toBeGreaterThan(0);
        expect(imageUrlsOf(items)).toStrictEqual(items.map(() => null));
      },
    );
  });
};
