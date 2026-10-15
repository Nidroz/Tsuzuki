import { describe, expect, it, jest } from '@jest/globals';

import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogProviderFailureError,
  CatalogResponseError,
  CatalogTimeoutError,
  type CatalogFailureKind,
} from '../errors/catalog-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import {
  EMPTY_PAGE,
  FAKE_INSTANCE_ID,
  FAKE_SEARCH_QUERY_MAX_LENGTH,
  SAMPLE_DETAIL,
  createFakeCatalogProvider,
} from './__fixtures__/fake-catalog-provider';
import {
  CATALOG_FAILURE_REPORT_INTERVAL_MS,
  CATALOG_FAILURE_THRESHOLD,
  CATALOG_FAILURE_WINDOW_MS,
  monitorCatalogProvider,
} from './catalog-failure-monitor';

const SEARCH_TEXT = 'secret query 42';
const MINUTE_MS = 60_000;

// a monitored fake provider on a manual clock, and its reporter
const setup = () => {
  const fake = createFakeCatalogProvider();
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const clock = { at: 0 };
  const monitored = monitorCatalogProvider(fake, {
    reporter: { captureError },
    now: () => clock.at,
  });
  // one search of the monitored provider, settled at `at` with `error`, or a page without one
  const searchAt = async (at: number, error?: unknown): Promise<void> => {
    clock.at = at;
    if (error === undefined) {
      fake.search.mockResolvedValueOnce(EMPTY_PAGE);
    } else {
      fake.search.mockRejectedValueOnce(error);
    }
    await monitored.search({ kind: 'anime', query: SEARCH_TEXT, page: 1 }).catch(() => undefined);
  };
  const reportedKinds = (): unknown[] =>
    captureError.mock.calls.map(([error]) =>
      error instanceof CatalogProviderFailureError ? error.kind : error,
    );
  return { fake, monitored, captureError, searchAt, reportedKinds };
};

const SERVER_ERROR = new CatalogHttpError(503, 2_000);

describe('monitorCatalogProvider', () => {
  it('keeps the namespace, the instance id and the search text limit', () => {
    const { monitored } = setup();

    expect(monitored.namespace).toBe('mal');
    expect(monitored.instanceId).toBe(FAKE_INSTANCE_ID);
    expect(monitored.searchQueryMaxLength).toBe(FAKE_SEARCH_QUERY_MAX_LENGTH);
  });

  it('forwards the arguments and passes values and errors through by identity', async () => {
    const { fake, monitored } = setup();
    const signal = new AbortController().signal;
    const params = { kind: 'anime', query: SEARCH_TEXT, page: 2 } as const;
    const key = SAMPLE_DETAIL.key;
    const genres = [{ id: 1, name: 'Action' }];
    fake.search.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    fake.getTop.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getCurrentSeason.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getGenres.mockResolvedValueOnce(genres);

    expect(await monitored.search(params, signal)).toBe(EMPTY_PAGE);
    expect(await monitored.getDetail(key)).toBe(SAMPLE_DETAIL);
    expect(await monitored.getTop('manga', 3, signal)).toBe(EMPTY_PAGE);
    expect(await monitored.getCurrentSeason(4)).toBe(EMPTY_PAGE);
    expect(await monitored.getGenres('anime', signal)).toBe(genres);
    expect(fake.search.mock.calls).toStrictEqual([[params, signal]]);
    expect(fake.search.mock.calls[0]?.[1]).toBe(signal);
    expect(fake.getDetail.mock.calls).toStrictEqual([[key]]);
    expect(fake.getTop.mock.calls).toStrictEqual([['manga', 3, signal]]);
    expect(fake.getCurrentSeason.mock.calls).toStrictEqual([[4]]);
    expect(fake.getGenres.mock.calls).toStrictEqual([['anime', signal]]);
  });

  it('rejects every method with the very error of the provider', async () => {
    const { fake, monitored } = setup();
    const errors = [SERVER_ERROR, new CatalogNetworkError(), new RangeError('x'), 'thrown', null];
    for (const error of errors) {
      fake.search.mockRejectedValueOnce(error);
      fake.getDetail.mockRejectedValueOnce(error);
      fake.getTop.mockRejectedValueOnce(error);
      fake.getCurrentSeason.mockRejectedValueOnce(error);
      fake.getGenres.mockRejectedValueOnce(error);

      await expect(monitored.search({ kind: 'anime', page: 1 })).rejects.toBe(error);
      await expect(monitored.getDetail(SAMPLE_DETAIL.key)).rejects.toBe(error);
      await expect(monitored.getTop('anime', 1)).rejects.toBe(error);
      await expect(monitored.getCurrentSeason(1)).rejects.toBe(error);
      await expect(monitored.getGenres('anime')).rejects.toBe(error);
    }
  });
});

describe('a sustained failure', () => {
  it.each<[string, CatalogFailureKind, unknown]>([
    ['a 500', 'server_error', new CatalogHttpError(500, null)],
    ['a 503 with Retry-After', 'server_error', SERVER_ERROR],
    ['a 429', 'rate_limited', new CatalogHttpError(429, 1_000)],
    ['a 400', 'client_error', new CatalogHttpError(400, null)],
    ['a 403', 'client_error', new CatalogHttpError(403, null)],
    ['a timeout', 'timeout', new CatalogTimeoutError(10_000)],
    ['a malformed response', 'malformed_response', new CatalogResponseError()],
  ])('of %s is reported once, as %s', async (_, kind, error) => {
    const { captureError, searchAt } = setup();

    await searchAt(0, error);
    await searchAt(MINUTE_MS, error);
    expect(captureError).not.toHaveBeenCalled();
    await searchAt(2 * MINUTE_MS, error);

    expect(captureError).toHaveBeenCalledTimes(1);
    const [reported, context] = captureError.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(CatalogProviderFailureError);
    expect(reported).toMatchObject({ kind, message: `Catalog provider is failing: ${kind}` });
    expect(context).toStrictEqual({
      source: 'catalog',
      tags: { instance: FAKE_INSTANCE_ID, kind },
    });
  });

  it('reports no url, query, search text, status or original error', async () => {
    const { captureError, searchAt } = setup();
    for (let failure = 0; failure < CATALOG_FAILURE_THRESHOLD; failure += 1) {
      await searchAt(failure, SERVER_ERROR);
    }

    const [reported, context] = captureError.mock.calls[0] ?? [];
    expect(reported).not.toBe(SERVER_ERROR);
    expect(reported).not.toHaveProperty('cause');
    const error = reported instanceof Error ? reported : new Error('not reported');
    const serialized = [
      String(error),
      JSON.stringify(error),
      JSON.stringify(context),
      ...Object.getOwnPropertyNames(error)
        .filter((name) => name !== 'stack')
        .map((name) => String(Object.getOwnPropertyDescriptor(error, name)?.value)),
    ].join('\n');
    for (const marker of ['https', '?', SEARCH_TEXT, '503', 'HTTP']) {
      expect(serialized).not.toContain(marker);
    }
  });

  it('is reset by a success', async () => {
    const { captureError, searchAt } = setup();

    await searchAt(0, SERVER_ERROR);
    await searchAt(1, SERVER_ERROR);
    await searchAt(2);
    await searchAt(3, SERVER_ERROR);
    await searchAt(4, SERVER_ERROR);
    expect(captureError).not.toHaveBeenCalled();
    await searchAt(5, SERVER_ERROR);

    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('counts only failures within 2 minutes of the latest one', async () => {
    const { captureError, searchAt } = setup();

    await searchAt(0, SERVER_ERROR);
    await searchAt(MINUTE_MS, SERVER_ERROR);
    // the first failure is now out of the window
    await searchAt(CATALOG_FAILURE_WINDOW_MS + 1, SERVER_ERROR);
    expect(captureError).not.toHaveBeenCalled();
    // the second one is exactly at the window edge, still counted
    await searchAt(MINUTE_MS + CATALOG_FAILURE_WINDOW_MS, SERVER_ERROR);

    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('reads performance.now() by default: fake timers move it, a wall clock jump does not', async () => {
    const fake = createFakeCatalogProvider();
    const captureError = jest.fn<ErrorReporter['captureError']>();
    const monitored = monitorCatalogProvider(fake, { reporter: { captureError } });
    fake.getTop.mockRejectedValue(SERVER_ERROR);
    // `count` failures, each followed by `move`
    const failAndMove = async (count: number, move: () => void): Promise<void> => {
      for (let failure = 0; failure < count; failure += 1) {
        await monitored.getTop('anime', 1).catch(() => undefined);
        move();
      }
    };

    await failAndMove(CATALOG_FAILURE_THRESHOLD, () => {
      jest.advanceTimersByTime(CATALOG_FAILURE_WINDOW_MS + 1);
    });
    expect(captureError).not.toHaveBeenCalled();
    await failAndMove(CATALOG_FAILURE_THRESHOLD, () => {
      jest.setSystemTime(Date.now() + CATALOG_FAILURE_WINDOW_MS + 1);
    });

    expect(captureError).toHaveBeenCalledTimes(1);
  });
});

describe('the report interval', () => {
  it('drops a kind reported less than 30 minutes ago, then reports it again', async () => {
    const { searchAt, reportedKinds } = setup();
    // three failures in a row from `at`
    const failFrom = async (at: number): Promise<void> => {
      for (let failure = 0; failure < CATALOG_FAILURE_THRESHOLD; failure += 1) {
        await searchAt(at + failure, SERVER_ERROR);
      }
    };

    // reported at 2 ms
    await failFrom(0);
    await failFrom(10 * MINUTE_MS);
    // deduplicated 1 ms before the interval ends, then the streak is cleared
    await failFrom(CATALOG_FAILURE_REPORT_INTERVAL_MS - 3);
    expect(reportedKinds()).toStrictEqual(['server_error']);
    // past the interval, within the window of the cleared streak: two failures are not enough
    await searchAt(CATALOG_FAILURE_REPORT_INTERVAL_MS + 2, SERVER_ERROR);
    await searchAt(CATALOG_FAILURE_REPORT_INTERVAL_MS + 3, SERVER_ERROR);
    expect(reportedKinds()).toStrictEqual(['server_error']);
    await searchAt(CATALOG_FAILURE_REPORT_INTERVAL_MS + 4, SERVER_ERROR);

    expect(reportedKinds()).toStrictEqual(['server_error', 'server_error']);
  });

  it('applies per kind, the kind of the failure that reaches the threshold', async () => {
    const { searchAt, reportedKinds } = setup();
    const timeout = new CatalogTimeoutError(10_000);

    await searchAt(0, SERVER_ERROR);
    await searchAt(1, SERVER_ERROR);
    await searchAt(2, timeout);
    await searchAt(3, timeout);
    await searchAt(4, timeout);
    await searchAt(5, SERVER_ERROR);

    expect(reportedKinds()).toStrictEqual(['timeout', 'server_error']);
  });

  it('lives in each monitor, never shared', async () => {
    const fake = createFakeCatalogProvider();
    const captureError = jest.fn<ErrorReporter['captureError']>();
    const options = { reporter: { captureError }, now: () => 0 };
    const monitors = [monitorCatalogProvider(fake, options), monitorCatalogProvider(fake, options)];
    fake.getGenres.mockRejectedValue(SERVER_ERROR);

    for (const monitor of [...monitors, ...monitors]) {
      await monitor.getGenres('anime').catch(() => undefined);
    }

    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('an error that says nothing about the provider', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';

  it.each<[string, unknown]>([
    ['a 404', new CatalogHttpError(404, null)],
    ['a network error', new CatalogNetworkError()],
    ['a catalog abort', new CatalogAbortedError()],
    ['a native abort', abort],
    ['an input RangeError', new RangeError('Catalog page must be a positive integer')],
    ['an unknown error', new TypeError('boom')],
    ['a thrown string', 'boom'],
  ])('is neither counted nor resetting: %s', async (_, ignored) => {
    const { captureError, searchAt } = setup();

    await searchAt(0, ignored);
    await searchAt(1, ignored);
    await searchAt(2, ignored);
    expect(captureError).not.toHaveBeenCalled();
    await searchAt(3, SERVER_ERROR);
    await searchAt(4, SERVER_ERROR);
    await searchAt(5, ignored);
    await searchAt(6, SERVER_ERROR);

    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when a missing title is opened again and again', async () => {
    const { fake, monitored, captureError } = setup();
    fake.getDetail.mockRejectedValue(new CatalogHttpError(404, null));

    for (let open = 0; open < 2 * CATALOG_FAILURE_THRESHOLD; open += 1) {
      await monitored.getDetail(SAMPLE_DETAIL.key).catch(() => undefined);
    }

    expect(fake.getDetail).toHaveBeenCalledTimes(2 * CATALOG_FAILURE_THRESHOLD);
    expect(captureError).not.toHaveBeenCalled();
  });
});
