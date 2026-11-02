import { describe, expect, it } from '@jest/globals';

import { CatalogHttpError, CatalogNetworkError } from '../errors/catalog-errors';
import { setupMonitor as setup } from './__fixtures__/monitored-provider';
import { CATALOG_FAILURE_THRESHOLD } from './catalog-failure-monitor';

// a failure shared by several callers is counted once, and a network error counts only while the
// device is online (ADR-0017 "Catalog failure monitor"). the shared failure over the real http
// client is in jikan/jikan-failure-monitor.test.ts

describe('the same error object', () => {
  it('is counted once, whichever method and however many callers reject with it', async () => {
    const { fake, monitored, captureError } = setup();
    const shared = new CatalogHttpError(500, null);
    fake.search.mockRejectedValue(shared);
    fake.getTop.mockRejectedValue(shared);

    for (let call = 0; call < CATALOG_FAILURE_THRESHOLD; call += 1) {
      await monitored.search({ kind: 'anime', page: 1 }).catch(() => undefined);
      await monitored.getTop({ kind: 'anime', page: 1 }).catch(() => undefined);
    }

    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('a network error', () => {
  it('is counted as network while the device is online', async () => {
    const { captureError, searchAt, reportedKinds } = setup({ isOnline: () => true });

    for (let failure = 0; failure < CATALOG_FAILURE_THRESHOLD; failure += 1) {
      await searchAt(failure, new CatalogNetworkError());
    }

    expect(reportedKinds()).toStrictEqual(['network']);
    expect(captureError.mock.calls[0]?.[1]).toMatchObject({ tags: { kind: 'network' } });
  });

  it('is neither counted nor resetting while the device is offline', async () => {
    const connectivity = { online: true };
    const { searchAt, reportedKinds } = setup({ isOnline: () => connectivity.online });

    await searchAt(0, new CatalogNetworkError());
    await searchAt(1, new CatalogNetworkError());
    connectivity.online = false;
    await searchAt(2, new CatalogNetworkError());
    await searchAt(3, new CatalogNetworkError());
    expect(reportedKinds()).toStrictEqual([]);
    connectivity.online = true;
    await searchAt(4, new CatalogNetworkError());

    expect(reportedKinds()).toStrictEqual(['network']);
  });

  it('is never counted without a connectivity source', async () => {
    const { searchAt, reportedKinds } = setup();

    for (let failure = 0; failure < 2 * CATALOG_FAILURE_THRESHOLD; failure += 1) {
      await searchAt(failure, new CatalogNetworkError());
    }

    expect(reportedKinds()).toStrictEqual([]);
  });
});
