import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider, MediaSummary, Page, TopParams } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { PERSISTED_CACHE_MAX_AGE, STALE_TIMES } from '../query/stale-times';
import {
  hookWrapper,
  LAST_PAGE,
  pageNumber,
  pendingUntilAborted,
  settle,
  summaryOf,
} from './__fixtures__/catalog-pages';
import { MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';
import { useTopMedia } from './use-top-media';

type GetTop = CatalogProvider['getTop'];

const TOP_ANIME: TopParams = { kind: 'anime', page: 1 };
const TOP_MANHWA: TopParams = { kind: 'manga', format: 'manhwa', page: 1 };
const BACKGROUND = { priority: 'background' } as const;

// foreground requests answer their page at once, background ones never settle by themselves
const answering: GetTop = (params, signal, options) =>
  options?.priority === 'background'
    ? pendingUntilAborted(signal)
    : Promise.resolve(pageNumber(params.page));

const setup = (params: TopParams, getTop: GetTop = answering) => {
  const provider = createFakeCatalogProvider();
  provider.getTop.mockImplementation(getTop);
  const queryClient = createQueryClient();
  const hook = renderHook(
    ({ params: current }: { readonly params: TopParams }) =>
      useTopMedia(current, { showAdult: false }),
    { initialProps: { params }, wrapper: hookWrapper(queryClient, provider) },
  );
  return { provider, queryClient, ...hook };
};

const backgroundCalls = (provider: ReturnType<typeof createFakeCatalogProvider>) =>
  provider.getTop.mock.calls.filter(([, , options]) => options?.priority === 'background');

describe('useTopMedia', () => {
  it('fetches the top page with the query signal under the top key, without a format key', async () => {
    const { provider, queryClient, result } = setup(TOP_ANIME);

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(provider.getTop).toHaveBeenNthCalledWith(1, TOP_ANIME, expect.any(AbortSignal));
    expect(provider.getTop.mock.calls[0]?.[0]).toStrictEqual(TOP_ANIME);
    expect(queryClient.getQueryData(queryKeys.top('mal', TOP_ANIME))).toStrictEqual(pageNumber(1));
    expect(result.current.query.data).toStrictEqual({ ...pageNumber(1), hiddenCount: 0 });
  });

  it('fetches and keys a top manga page with its format', async () => {
    const { provider, queryClient, result } = setup(TOP_MANHWA);

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(provider.getTop).toHaveBeenNthCalledWith(1, TOP_MANHWA, expect.any(AbortSignal));
    expect(queryClient.getQueryData(queryKeys.top('mal', TOP_MANHWA))).toStrictEqual(pageNumber(1));
    expect(
      queryClient.getQueryData(queryKeys.top('mal', { kind: 'manga', page: 1 })),
    ).toBeUndefined();
  });

  it('keeps pages fresh for STALE_TIMES.top, in memory for the default gc time', async () => {
    const { queryClient, result } = setup(TOP_ANIME);
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    expect(result.current.query.isStale).toBe(false);
    const freshUntil = result.current.query.dataUpdatedAt + STALE_TIMES.top;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(freshUntil - Date.now() - 1);
    });

    expect(result.current.query.isStale).toBe(false);
    await waitFor(() => {
      expect(result.current.query.isStale).toBe(true);
    });
    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.top('mal', TOP_ANIME) });
    expect(query?.gcTime).toBe(PERSISTED_CACHE_MAX_AGE);
  });

  it('BR-06: hides adult titles and counts them', async () => {
    const page: Page<MediaSummary> = {
      ...pageNumber(1),
      items: [summaryOf(1), summaryOf(2, 'anime', true)],
    };
    const { result } = setup(TOP_ANIME, () => Promise.resolve(page));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(result.current.query.data?.items).toStrictEqual([summaryOf(1)]);
    expect(result.current.query.data?.hiddenCount).toBe(1);
  });

  it('keeps the page before as placeholder while another page of the list loads', async () => {
    const { provider, result, rerender } = setup(TOP_ANIME);
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.getTop.mockImplementation((_params, signal) => pendingUntilAborted(signal));

    rerender({ params: { ...TOP_ANIME, page: LAST_PAGE } });
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.page).toBe(1);
    expect(result.current.isPlaceholderFromOtherList).toBe(false);
  });

  it.each<[string, TopParams]>([
    ['another kind', { kind: 'manga', page: 1 }],
    ['a format', { kind: 'anime', format: 'movie', page: 1 }],
  ])('starts %s without a placeholder', async (_case, next) => {
    const { provider, result, rerender } = setup(TOP_ANIME);
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.getTop.mockImplementation((_params, signal) => pendingUntilAborted(signal));

    rerender({ params: next });
    await settle();

    expect(provider.getTop).toHaveBeenLastCalledWith(next, expect.any(AbortSignal));
    expect(result.current.query.isPending).toBe(true);
    expect(result.current.query.data).toBeUndefined();
    expect(result.current.isPlaceholderFromOtherList).toBe(false);
  });

  it('prefetches the next page in the background, aborted by a format change only', async () => {
    const { provider, result, rerender } = setup(TOP_ANIME);
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });

    expect(backgroundCalls(provider)[0]).toStrictEqual([
      { kind: 'anime', page: 2 },
      expect.any(AbortSignal),
      BACKGROUND,
    ]);
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];

    rerender({ params: { ...TOP_ANIME, page: 2 } });
    await settle();

    expect(prefetchSignal?.aborted).toBe(false);
    expect(result.current.query.data?.page).toBe(2);

    rerender({ params: { kind: 'anime', format: 'tv', page: 1 } });
    await settle();

    expect(prefetchSignal?.aborted).toBe(true);
  });

  it('stores a prefetched page under its key', async () => {
    const { provider, queryClient } = setup(TOP_MANHWA, (params) =>
      Promise.resolve(pageNumber(params.page)),
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.top('mal', { ...TOP_MANHWA, page: 2 }))).toEqual(
        pageNumber(2),
      );
    });
    expect(provider.getTop).toHaveBeenLastCalledWith(
      { ...TOP_MANHWA, page: 2 },
      expect.any(AbortSignal),
      BACKGROUND,
    );
  });

  it('throws outside CatalogContextProvider', () => {
    const queryClient = createQueryClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    expect(() =>
      renderHook(() => useTopMedia(TOP_ANIME, { showAdult: false }), { wrapper }),
    ).toThrow(MISSING_CATALOG_PROVIDER_MESSAGE);
  });
});
