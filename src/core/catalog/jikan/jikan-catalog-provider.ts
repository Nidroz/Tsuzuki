// the jikan v4 catalog provider (ADR-0003, docs/ARCHITECTURE.md §3): urls in jikan-urls.ts,
// payload schemas in jikan-schemas.ts, mapping in jikan-mappers.ts. every request goes through the
// provider's own rate limited http client with the caller's signal; its errors pass through as is
import type { CatalogProvider } from '../catalog-provider';
import {
  createCatalogHttpClient,
  type CatalogHttpClientOptions,
} from '../http/catalog-http-client';
import { parseJikanDetail, parseJikanGenres, parseJikanPage } from './jikan-mappers';
import { JIKAN_RATE_LIMIT } from './jikan-rate-limit';
import {
  jikanDetailUrl,
  jikanGenresUrl,
  jikanSearchUrl,
  jikanSeasonNowUrl,
  jikanTopUrl,
} from './jikan-urls';

/** the http client options of the provider; the rate limit is always `JIKAN_RATE_LIMIT`. */
export type JikanCatalogProviderOptions = Omit<CatalogHttpClientOptions, 'rateLimit'>;

const SEASON_KIND = 'anime';

/** a jikan provider with its own http client: one per composition root, never a singleton. */
export const createJikanCatalogProvider = (
  options: JikanCatalogProviderOptions = {},
): CatalogProvider => {
  const client = createCatalogHttpClient({ ...options, rateLimit: JIKAN_RATE_LIMIT });
  return {
    id: 'jikan',
    search: async (params, signal) => {
      // built first: an invalid param throws before any request
      const url = jikanSearchUrl(params);
      return parseJikanPage(params.kind, params.page, await client.getJson(url, signal));
    },
    getDetail: async (key, signal) => {
      const url = jikanDetailUrl(key);
      return parseJikanDetail(key, await client.getJson(url, signal));
    },
    getTop: async (kind, page, signal) => {
      const url = jikanTopUrl(kind, page);
      return parseJikanPage(kind, page, await client.getJson(url, signal));
    },
    getCurrentSeason: async (page, signal) => {
      const url = jikanSeasonNowUrl(page);
      return parseJikanPage(SEASON_KIND, page, await client.getJson(url, signal));
    },
    getGenres: async (kind, signal) => {
      const url = jikanGenresUrl(kind);
      return parseJikanGenres(await client.getJson(url, signal));
    },
  } satisfies CatalogProvider;
};
