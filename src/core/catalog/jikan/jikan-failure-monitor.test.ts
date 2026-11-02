import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { CatalogHttpError, CatalogResponseError } from '../../errors/catalog-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import { monitorCatalogProvider } from '../catalog-failure-monitor';
import type { CatalogProvider } from '../catalog-provider';
import { TENRAI_BASE } from './__fixtures__/jikan-handlers';
import { createJikanCatalogProvider } from './jikan-catalog-provider';
import { TENRAI_INSTANCE } from './jikan-instances';

// the failure monitor over the jikan adapter and its http client (ADR-0017 "Catalog failure
// monitor"): a foreground call that joins a background prefetch in flight shares its request, so
// an http failure is one error object for both callers, counted once; the adapter parses the body
// per caller, so a payload failing its schema is one error per caller, counted per caller

const TOP_URL = `${TENRAI_BASE}/top/anime`;
const BACKGROUND = { priority: 'background' } as const;
// longer than every token wait of these requests
const LONG_AFTER_MS = 60_000;

const monitoredJikan = () => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const monitored = monitorCatalogProvider(createJikanCatalogProvider(TENRAI_INSTANCE), {
    reporter: { captureError },
    now: () => 0,
  });
  return { monitored, captureError };
};

// a background prefetch of page 2 and the foreground call that joins it, both settled
const prefetchThenShow = async (provider: CatalogProvider): Promise<unknown[]> => {
  const settled = Promise.all([
    provider
      .getTop({ kind: 'anime', page: 2 }, undefined, BACKGROUND)
      .catch((error: unknown) => error),
    provider.getTop({ kind: 'anime', page: 2 }).catch((error: unknown) => error),
  ]);
  await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
  return settled;
};

describe('a foreground call that joined a background prefetch', () => {
  it('rejects with the very error of the prefetch, counted once', async () => {
    const requests: string[] = [];
    server.use(
      http.get(TOP_URL, ({ request }) => {
        requests.push(request.url);
        return new HttpResponse(null, { status: 400 });
      }),
    );
    const { monitored, captureError } = monitoredJikan();

    const [prefetchError, shownError] = await prefetchThenShow(monitored);
    await prefetchThenShow(monitored);

    expect(prefetchError).toBeInstanceOf(CatalogHttpError);
    expect(shownError).toBe(prefetchError);
    expect(requests).toHaveLength(2);
    // four failed calls, two failed requests: below the threshold
    expect(captureError).not.toHaveBeenCalled();
    await prefetchThenShow(monitored);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('rejects with its own error for a payload failing its schema, counted per caller', async () => {
    server.use(http.get(TOP_URL, () => HttpResponse.json({ data: 'not a page' })));
    const { monitored, captureError } = monitoredJikan();

    const [prefetchError, shownError] = await prefetchThenShow(monitored);
    await prefetchThenShow(monitored);

    expect(prefetchError).toBeInstanceOf(CatalogResponseError);
    expect(shownError).toBeInstanceOf(CatalogResponseError);
    expect(shownError).not.toBe(prefetchError);
    // four failed calls of two requests reach the threshold of three
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
