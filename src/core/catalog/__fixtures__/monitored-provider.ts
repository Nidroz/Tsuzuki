// a monitored fake provider on a manual clock, for the catalog failure monitor tests
import { jest } from '@jest/globals';

import { CatalogHttpError, CatalogProviderFailureError } from '../../errors/catalog-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import { monitorCatalogProvider } from '../catalog-failure-monitor';
import { EMPTY_PAGE, createFakeCatalogProvider } from './fake-catalog-provider';

export const SEARCH_TEXT = 'secret query 42';
export const MINUTE_MS = 60_000;
export const SERVER_ERROR = new CatalogHttpError(503, 2_000);

/** a monitored fake provider on a manual clock, and its reporter */
export const setupMonitor = () => {
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
