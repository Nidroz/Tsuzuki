// the catalog provider of any jikan v4 compatible instance (ADR-0003, docs/ARCHITECTURE.md §3):
// instances in jikan-instances.ts, urls in jikan-urls.ts, payload schemas in jikan-schemas.ts,
// mapping in jikan-mappers.ts. every request goes through the provider's own rate limited http
// client with the caller's signal; its errors pass through as is
import type { CatalogProvider } from '../catalog-provider';
import {
  createCatalogHttpClient,
  type CatalogHttpClientOptions,
} from '../http/catalog-http-client';
import { JIKAN_NAMESPACE, type JikanInstance } from './jikan-instances';
import { parseJikanDetail, parseJikanGenres, parseJikanPage } from './jikan-mappers';
import {
  jikanDetailUrl,
  jikanGenresUrl,
  jikanSearchUrl,
  jikanSeasonNowUrl,
  jikanTopUrl,
} from './jikan-urls';

/** the http client options of the provider; the rate limit is always the instance's own. */
export type JikanCatalogProviderOptions = Omit<CatalogHttpClientOptions, 'rateLimit'>;

const SEASON_KIND = 'anime';

/**
 * a provider of `instance` with its own http client, so its own rate limiter: one per instance and
 * composition root, never a singleton.
 */
export const createJikanCatalogProvider = (
  instance: JikanInstance,
  options: JikanCatalogProviderOptions = {},
): CatalogProvider => {
  const { baseUrl } = instance;
  const client = createCatalogHttpClient({ ...options, rateLimit: instance.rateLimit });
  return {
    namespace: JIKAN_NAMESPACE,
    instanceId: instance.id,
    search: async (params, signal) => {
      // built first: an invalid param throws before any request
      const url = jikanSearchUrl(baseUrl, params);
      return parseJikanPage(params.kind, params.page, await client.getJson(url, signal));
    },
    getDetail: async (key, signal) => {
      const url = jikanDetailUrl(baseUrl, key);
      return parseJikanDetail(key, await client.getJson(url, signal));
    },
    getTop: async (kind, page, signal) => {
      const url = jikanTopUrl(baseUrl, kind, page);
      return parseJikanPage(kind, page, await client.getJson(url, signal));
    },
    getCurrentSeason: async (page, signal) => {
      const url = jikanSeasonNowUrl(baseUrl, page);
      return parseJikanPage(SEASON_KIND, page, await client.getJson(url, signal));
    },
    getGenres: async (kind, signal) => {
      const url = jikanGenresUrl(baseUrl, kind);
      return parseJikanGenres(await client.getJson(url, signal));
    },
  } satisfies CatalogProvider;
};
