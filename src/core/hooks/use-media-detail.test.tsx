import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  createStrictFakeCatalogProvider,
  SAMPLE_DETAIL,
} from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider, MediaDetail } from '../catalog/catalog-provider';
import type { MediaKey } from '../domain/media';
import { CatalogHttpError, CatalogNetworkError } from '../errors/catalog-errors';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { STALE_TIMES } from '../query/stale-times';
import { CatalogContextProvider } from './CatalogContextProvider';
import { useMediaDetail } from './use-media-detail';

// a synthetic adult anime (BR-06): the recordings hold no adult title
const ADULT_DETAIL: MediaDetail = {
  ...SAMPLE_DETAIL,
  key: { namespace: 'mal', kind: 'anime', externalId: 2 },
  title: 'Adult placeholder',
  genres: [{ id: 12, name: 'Hentai' }],
  isAdult: true,
};
const OTHER_KEY: MediaKey = { namespace: 'mal', kind: 'manga', externalId: 3 };

// long enough for any retry with backoff to have happened
const NO_RETRY_WINDOW_MS = 60_000;

type GetDetail = CatalogProvider['getDetail'];

interface HookProps {
  readonly mediaKey: MediaKey;
  readonly showAdult: boolean;
}

const resolvesWith =
  (detail: MediaDetail): GetDetail =>
  () =>
    Promise.resolve(detail);

const wrapperOf =
  (provider: CatalogProvider, queryClient: QueryClient) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
    </QueryClientProvider>
  );

const renderDetail = (
  provider: CatalogProvider,
  queryClient: QueryClient,
  { mediaKey, showAdult }: HookProps,
) =>
  renderHook(
    ({ mediaKey: key, showAdult: show }: HookProps) => useMediaDetail(key, { showAdult: show }),
    { initialProps: { mediaKey, showAdult }, wrapper: wrapperOf(provider, queryClient) },
  );

// the provider answers with `getDetail`, set before the first render, which starts the request
const setup = (
  detail: MediaDetail,
  getDetail: GetDetail = resolvesWith(detail),
  showAdult = false,
) => {
  const provider = createStrictFakeCatalogProvider({ getDetail });
  const queryClient = createQueryClient();
  const hook = renderDetail(provider, queryClient, { mediaKey: detail.key, showAdult });
  return { provider, queryClient, ...hook };
};

describe('useMediaDetail', () => {
  it('fetches the detail of the key with the query signal, under the media key', async () => {
    const { provider, queryClient, result } = setup(SAMPLE_DETAIL);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(provider.getDetail).toHaveBeenCalledTimes(1);
    expect(provider.getDetail).toHaveBeenCalledWith(SAMPLE_DETAIL.key, expect.any(AbortSignal));
    expect(queryClient.getQueryData(queryKeys.media(SAMPLE_DETAIL.key))).toBe(SAMPLE_DETAIL);
    expect(result.current.data).toStrictEqual({ hidden: false, media: SAMPLE_DETAIL });
  });

  it('hides an adult title with adult content off, keeping it whole in the cache (BR-06)', async () => {
    const { queryClient, result } = setup(ADULT_DETAIL);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toStrictEqual({ hidden: true });
    expect(queryClient.getQueryData(queryKeys.media(ADULT_DETAIL.key))).toBe(ADULT_DETAIL);
  });

  it('shows an adult title with adult content on (BR-06)', async () => {
    const { result } = setup(ADULT_DETAIL, resolvesWith(ADULT_DETAIL), true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toStrictEqual({ hidden: false, media: ADULT_DETAIL });
  });

  it('applies a toggled adult content setting to the cached detail without a refetch (BR-06)', async () => {
    const { provider, result, rerender } = setup(ADULT_DETAIL);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ mediaKey: ADULT_DETAIL.key, showAdult: true });

    expect(result.current.data).toStrictEqual({ hidden: false, media: ADULT_DETAIL });

    rerender({ mediaKey: ADULT_DETAIL.key, showAdult: false });

    expect(result.current.data).toStrictEqual({ hidden: true });
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps the same selected result across renders without new data', async () => {
    const { result, rerender } = setup(SAMPLE_DETAIL);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const first = result.current.data;

    rerender({ mediaKey: SAMPLE_DETAIL.key, showAdult: false });
    rerender({ mediaKey: SAMPLE_DETAIL.key, showAdult: false });

    expect(result.current.data).toBe(first);
  });

  it('serves a second mount from the cache for STALE_TIMES.mediaDetail, then refetches', async () => {
    const { provider, queryClient, result, unmount } = setup(SAMPLE_DETAIL);
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.media(SAMPLE_DETAIL.key) })?.options,
    ).toMatchObject({ staleTime: STALE_TIMES.mediaDetail });
    // waitFor advanced the clock too: the stale time counts from the data's arrival
    const untilStaleMs = result.current.dataUpdatedAt + STALE_TIMES.mediaDetail - Date.now();
    unmount();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(untilStaleMs - 1);
    });
    const fresh = renderDetail(provider, queryClient, {
      mediaKey: SAMPLE_DETAIL.key,
      showAdult: false,
    });

    expect(fresh.result.current.data).toStrictEqual({ hidden: false, media: SAMPLE_DETAIL });
    expect(fresh.result.current.isStale).toBe(false);
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
    fresh.unmount();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    const stale = renderDetail(provider, queryClient, {
      mediaKey: SAMPLE_DETAIL.key,
      showAdult: false,
    });

    await waitFor(() => {
      expect(provider.getDetail).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(stale.result.current.isFetching).toBe(false);
    });
  });

  it.each([
    ['a missing title', new CatalogHttpError(404, null)],
    ['a network failure', new CatalogNetworkError()],
  ])('surfaces %s after a single call', async (_case, error) => {
    const { provider, result } = setup(SAMPLE_DETAIL, () => Promise.reject(error));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NO_RETRY_WINDOW_MS);
    });

    expect(result.current.error).toBe(error);
    expect(result.current.data).toBeUndefined();
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
  });

  it('aborts the request of a key it leaves', async () => {
    const signals: AbortSignal[] = [];
    const pendingUntilAborted: GetDetail = (_key, signal) =>
      new Promise<MediaDetail>((_resolve, reject) => {
        if (signal !== undefined) {
          signals.push(signal);
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }
      });
    const { provider, rerender } = setup(SAMPLE_DETAIL, pendingUntilAborted);
    await waitFor(() => {
      expect(signals).toHaveLength(1);
    });

    rerender({ mediaKey: OTHER_KEY, showAdult: false });

    await waitFor(() => {
      expect(signals[0]?.aborted).toBe(true);
    });
    expect(provider.getDetail).toHaveBeenLastCalledWith(OTHER_KEY, expect.any(AbortSignal));
  });
});
