import { describe, expect, it } from '@jest/globals';

import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
} from '../errors/catalog-errors';
import {
  EMPTY_PAGE,
  FAKE_INSTANCE_ID,
  FAKE_SEARCH_GENRES_MAX,
  FAKE_SEARCH_QUERY_MAX_LENGTH,
  SAMPLE_DETAIL,
} from './__fixtures__/fake-catalog-provider';
import {
  SEARCH_TEXT,
  SERVER_ERROR,
  setupMonitor as setup,
} from './__fixtures__/monitored-provider';
import { CATALOG_FAILURE_THRESHOLD } from './catalog-failure-monitor';

// the monitor as a provider: what it forwards and returns, and the errors it never counts. what
// it reports and when lives in catalog-failure-monitor-reports.test.ts

describe('monitorCatalogProvider', () => {
  it('keeps the namespace, the instance id and the search limits', () => {
    const { monitored } = setup();

    expect(monitored.namespace).toBe('mal');
    expect(monitored.instanceId).toBe(FAKE_INSTANCE_ID);
    expect(monitored.searchQueryMaxLength).toBe(FAKE_SEARCH_QUERY_MAX_LENGTH);
    expect(monitored.searchGenresMax).toBe(FAKE_SEARCH_GENRES_MAX);
  });

  it('forwards the arguments and passes values and errors through by identity', async () => {
    const { fake, monitored } = setup();
    const signal = new AbortController().signal;
    const params = { kind: 'anime', query: SEARCH_TEXT, page: 2 } as const;
    const key = SAMPLE_DETAIL.key;
    const genres = [{ id: 1, name: 'Action' }];
    const background = { priority: 'background' } as const;
    fake.search.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getDetail.mockResolvedValueOnce(SAMPLE_DETAIL);
    fake.getTop.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getCurrentSeason.mockResolvedValueOnce(EMPTY_PAGE);
    fake.getGenres.mockResolvedValueOnce(genres);

    expect(await monitored.search(params, signal, background)).toBe(EMPTY_PAGE);
    expect(await monitored.getDetail(key)).toBe(SAMPLE_DETAIL);
    expect(await monitored.getTop({ kind: 'manga', page: 3 }, signal)).toBe(EMPTY_PAGE);
    expect(await monitored.getCurrentSeason(4, undefined, background)).toBe(EMPTY_PAGE);
    expect(await monitored.getGenres('anime', signal)).toBe(genres);
    expect(fake.search.mock.calls).toStrictEqual([[params, signal, background]]);
    expect(fake.search.mock.calls[0]?.[1]).toBe(signal);
    expect(fake.getDetail.mock.calls).toStrictEqual([[key]]);
    expect(fake.getTop.mock.calls).toStrictEqual([[{ kind: 'manga', page: 3 }, signal]]);
    expect(fake.getCurrentSeason.mock.calls).toStrictEqual([[4, undefined, background]]);
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
      await expect(monitored.getTop({ kind: 'anime', page: 1 })).rejects.toBe(error);
      await expect(monitored.getCurrentSeason(1)).rejects.toBe(error);
      await expect(monitored.getGenres('anime')).rejects.toBe(error);
    }
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
