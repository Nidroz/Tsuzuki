import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { CatalogProvider, CatalogRequestOptions } from '../catalog-provider';
import { buildJikanAnime, buildJikanGenres, buildJikanPage } from './__fixtures__/jikan-builders';
import { TENRAI_BASE } from './__fixtures__/jikan-handlers';
import { createJikanCatalogProvider } from './jikan-catalog-provider';
import { TENRAI_INSTANCE } from './jikan-instances';

// the request priority of the paged methods reaches the provider's http client (C-06): on the
// tenrai policy, a background page waits behind a foreground page asked after it

// longer than the token waits of these tests
const LONG_AFTER_MS = 10_000;
const BACKGROUND: CatalogRequestOptions = { priority: 'background' };

interface PagedCase {
  readonly name: string;
  readonly path: string;
  readonly call: (
    provider: CatalogProvider,
    page: number,
    options?: CatalogRequestOptions,
  ) => Promise<unknown>;
}

const PAGED_CASES: readonly PagedCase[] = [
  {
    name: 'search',
    path: '/anime',
    call: (provider, page, options) =>
      provider.search({ kind: 'anime', query: 'sample', page }, undefined, options),
  },
  {
    name: 'getTop',
    path: '/top/anime',
    call: (provider, page, options) => provider.getTop('anime', page, undefined, options),
  },
  {
    name: 'getCurrentSeason',
    path: '/seasons/now',
    call: (provider, page, options) => provider.getCurrentSeason(page, undefined, options),
  },
];

// answers every request of `path` with a page, and records the page each one asked for
const servePages = (path: string): string[] => {
  const pages: string[] = [];
  server.use(
    http.get(`${TENRAI_BASE}${path}`, ({ request }) => {
      pages.push(new URL(request.url).searchParams.get('page') ?? '');
      return HttpResponse.json(buildJikanPage([buildJikanAnime()]));
    }),
  );
  return pages;
};

describe.each(PAGED_CASES)('$name', ({ path, call }) => {
  it('sends a background page after a foreground page asked after it', async () => {
    server.use(
      http.get(`${TENRAI_BASE}/genres/anime`, () =>
        HttpResponse.json(buildJikanGenres([[1, 'Action']])),
      ),
    );
    const pages = servePages(path);
    const provider = createJikanCatalogProvider(TENRAI_INSTANCE);

    // one of the two tokens is taken: a background request now waits for the bucket to refill
    const results = Promise.all([
      provider.getGenres('anime'),
      call(provider, 2, BACKGROUND),
      call(provider, 1),
    ]);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    await results;

    expect(pages).toStrictEqual(['1', '2']);
  });

  it('sends a foreground page first in call order', async () => {
    const pages = servePages(path);
    const provider = createJikanCatalogProvider(TENRAI_INSTANCE);

    const results = Promise.all([call(provider, 2), call(provider, 1)]);
    await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
    await results;

    expect(pages).toStrictEqual(['2', '1']);
  });
});
