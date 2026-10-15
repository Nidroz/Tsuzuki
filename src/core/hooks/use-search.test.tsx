import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  createFakeCatalogProvider,
  EMPTY_PAGE,
} from '../catalog/__fixtures__/fake-catalog-provider';
import type {
  CatalogProvider,
  MediaSummary,
  Page,
  SearchParams,
} from '../catalog/catalog-provider';
import { CatalogNetworkError } from '../errors/catalog-errors';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { SEARCH_GC_TIME, STALE_TIMES } from '../query/stale-times';
import { MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';
import { CatalogContextProvider } from './CatalogContextProvider';
import { SEARCH_DEBOUNCE_MS, useSearch } from './use-search';

const summary = (externalId: number, isAdult = false): MediaSummary => ({
  key: { namespace: 'mal', kind: 'anime', externalId },
  title: `Title ${String(externalId)}`,
  titleEnglish: null,
  imageUrl: null,
  format: 'tv',
  status: 'finished',
  totalUnits: null,
  score: null,
  year: null,
  genres: [],
  isAdult,
});

const pageOf = (...items: MediaSummary[]): Page<MediaSummary> => ({ ...EMPTY_PAGE, items });

const FRIEREN: SearchParams = { kind: 'anime', query: 'frieren', page: 1 };
const MUSHISHI: SearchParams = { kind: 'anime', query: 'mushishi', page: 1 };
const FRIEREN_MANGA: SearchParams = { kind: 'manga', query: 'frieren', page: 1 };
const CLEAN = summary(1);
const ADULT = summary(2, true);

interface HookProps {
  readonly params: SearchParams | null;
  readonly showAdult: boolean;
}

type Search = CatalogProvider['search'];

// the provider answers with `search`, set before the first render, which starts the request
const setup = (params: SearchParams | null, search?: Search, showAdult = false) => {
  const provider = createFakeCatalogProvider();
  if (search !== undefined) {
    provider.search.mockImplementation(search);
  }
  const queryClient: QueryClient = createQueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    ({ params: current, showAdult: show }: HookProps) => useSearch(current, { showAdult: show }),
    { initialProps: { params, showAdult }, wrapper },
  );
  return { provider, queryClient, ...hook };
};

// a search that never settles by itself: it rejects when its signal aborts
const pendingUntilAborted: Search = (_params, signal) =>
  new Promise<Page<MediaSummary>>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

const resolvesWith =
  (page: Page<MediaSummary>): Search =>
  () =>
    Promise.resolve(page);
const rejectsWith =
  (error: Error): Search =>
  () =>
    Promise.reject(error);

describe('useSearch', () => {
  it('waits 400 ms of unchanged text before a search (FR-01)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(400);
  });

  it('stays idle and calls no provider without params', async () => {
    const { provider, queryClient, result } = setup(null);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(provider.search).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.searchIdle('mal') }),
    ).toBeDefined();
  });

  it('searches the provider with the params and the query signal, under the search key', async () => {
    const { provider, queryClient, result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(FRIEREN, expect.any(AbortSignal));
    expect(queryClient.getQueryData(queryKeys.search('mal', FRIEREN))).toStrictEqual(pageOf(CLEAN));
    expect(result.current.data).toStrictEqual({ ...pageOf(CLEAN), hiddenCount: 0 });
  });

  it('keeps unused searches in memory for SEARCH_GC_TIME', async () => {
    const { queryClient, result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.search('mal', FRIEREN) });

    expect(query?.gcTime).toBe(SEARCH_GC_TIME);
  });

  it('keeps results fresh for STALE_TIMES.search', async () => {
    const { result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // read before the time passes, so the hook re-renders when it changes
    expect(result.current.isStale).toBe(false);
    const freshUntil = result.current.dataUpdatedAt + STALE_TIMES.search;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(freshUntil - Date.now() - 1);
    });

    expect(result.current.isStale).toBe(false);

    // the observer marks the data stale on a timer of its own, a millisecond after the stale time
    await waitFor(() => {
      expect(result.current.isStale).toBe(true);
    });
  });

  it('hides adult titles and counts them with adult content off (BR-06)', async () => {
    const { result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN, ADULT)));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.items).toStrictEqual([CLEAN]);
    expect(result.current.data?.hiddenCount).toBe(1);
  });

  it('filters the cached page again without a refetch when the setting changes', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN, ADULT)));
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ params: FRIEREN, showAdult: true });

    expect(result.current.data?.items).toStrictEqual([CLEAN, ADULT]);
    expect(result.current.data?.hiddenCount).toBe(0);

    rerender({ params: FRIEREN, showAdult: false });

    expect(result.current.data?.items).toStrictEqual([CLEAN]);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(result.current.isFetching).toBe(false);
  });

  it('aborts the request of a key it leaves', async () => {
    const { provider, rerender } = setup(FRIEREN, pendingUntilAborted);
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(1);
    });
    const firstSignal = provider.search.mock.calls[0]?.[1];

    expect(firstSignal?.aborted).toBe(false);

    rerender({ params: FRIEREN_MANGA, showAdult: false });
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(2);
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(provider.search).toHaveBeenLastCalledWith(FRIEREN_MANGA, expect.any(AbortSignal));
    expect(provider.search.mock.calls[1]?.[1]?.aborted).toBe(false);
  });

  it('aborts a pending request when the params go back to null', async () => {
    const { provider, rerender, result } = setup(FRIEREN, pendingUntilAborted);
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(1);
    });

    rerender({ params: null, showAdult: false });

    await waitFor(() => {
      expect(provider.search.mock.calls[0]?.[1]?.aborted).toBe(true);
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('keeps the previous results as placeholder data while a new key loads', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    provider.search.mockImplementation(pendingUntilAborted);

    rerender({ params: MUSHISHI, showAdult: false });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.items).toStrictEqual([CLEAN]);
  });

  it('surfaces a provider error after a single call, never retrying', async () => {
    const error = new CatalogNetworkError();
    const { provider, result } = setup(FRIEREN, rejectsWith(error));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STALE_TIMES.search);
    });

    expect(result.current.error).toBe(error);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it('searches again on refetch', async () => {
    const { provider, result } = setup(FRIEREN, rejectsWith(new CatalogNetworkError()));
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    provider.search.mockResolvedValue(pageOf(CLEAN));

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data?.items).toStrictEqual([CLEAN]);
    });
    expect(provider.search).toHaveBeenCalledTimes(2);
  });

  it('throws outside CatalogContextProvider', () => {
    const queryClient = createQueryClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    expect(() => renderHook(() => useSearch(null, { showAdult: false }), { wrapper })).toThrow(
      MISSING_CATALOG_PROVIDER_MESSAGE,
    );
  });
});
