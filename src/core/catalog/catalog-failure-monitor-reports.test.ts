import { describe, expect, it, jest } from '@jest/globals';

import {
  CatalogHttpError,
  CatalogProviderFailureError,
  CatalogResponseError,
  CatalogTimeoutError,
  type CatalogFailureKind,
} from '../errors/catalog-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import { createFakeCatalogProvider, FAKE_INSTANCE_ID } from './__fixtures__/fake-catalog-provider';
import {
  MINUTE_MS,
  SEARCH_TEXT,
  SERVER_ERROR,
  setupMonitor as setup,
} from './__fixtures__/monitored-provider';
import {
  CATALOG_FAILURE_REPORT_INTERVAL_MS,
  CATALOG_FAILURE_THRESHOLD,
  CATALOG_FAILURE_WINDOW_MS,
  monitorCatalogProvider,
} from './catalog-failure-monitor';

// what the monitor reports and when: a sustained failure per kind, within the window, once per
// report interval

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
        await monitored.getTop({ kind: 'anime', page: 1 }).catch(() => undefined);
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
