// the catalog provider of any jikan v4 compatible instance (ADR-0003, docs/ARCHITECTURE.md §3):
// instances in jikan-instances.ts, urls in jikan-urls.ts, payload schemas in jikan-schemas.ts,
// mapping in jikan-mappers.ts. every request goes through the provider's own rate limited http
// client with the caller's signal, and the request priority of the paged methods; its errors pass
// through as is
import type { CatalogProvider } from '../catalog-provider';
import {
  createCatalogHttpClient,
  type CatalogHttpClientOptions,
} from '../http/catalog-http-client';
import { JIKAN_NAMESPACE, type JikanInstance } from './jikan-instances';
import { parseJikanDetail, parseJikanGenres, parseJikanPage } from './jikan-mappers';
import {
  JIKAN_GENRE_IDS_MAX,
  JIKAN_QUERY_MAX_LENGTH,
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
    searchQueryMaxLength: JIKAN_QUERY_MAX_LENGTH,
    searchGenresMax: JIKAN_GENRE_IDS_MAX,
    search: async (params, signal, requestOptions) => {
      // built first: an invalid param throws before any request
      const url = jikanSearchUrl(baseUrl, params);
      const body = await client.getJson(url, signal, requestOptions);
      return parseJikanPage(params.kind, params.page, body);
    },
    getDetail: async (key, signal) => {
      const url = jikanDetailUrl(baseUrl, key);
      return parseJikanDetail(key, await client.getJson(url, signal));
    },
    getTop: async (params, signal, requestOptions) => {
      const url = jikanTopUrl(baseUrl, params);
      const body = await client.getJson(url, signal, requestOptions);
      return parseJikanPage(params.kind, params.page, body);
    },
    getCurrentSeason: async (page, signal, requestOptions) => {
      const url = jikanSeasonNowUrl(baseUrl, page);
      return parseJikanPage(SEASON_KIND, page, await client.getJson(url, signal, requestOptions));
    },
    getGenres: async (kind, signal) => {
      const url = jikanGenresUrl(baseUrl, kind);
      return parseJikanGenres(await client.getJson(url, signal));
    },
  } satisfies CatalogProvider;
};
