import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { CatalogNetworkError } from '../errors/catalog-errors';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { SEARCH_GC_TIME, STALE_TIMES } from '../query/stale-times';
import {
  ADULT,
  CLEAN,
  FRIEREN,
  pageOf,
  rejectsWith,
  resolvesWith,
  setupSearch as setup,
} from './__fixtures__/search-hook';
import { MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';
import { SEARCH_DEBOUNCE_MS, useSearch } from './use-search';

// the request, the cache, the content filter and the errors of useSearch. what happens when the
// key changes (abort, placeholder data) lives in use-search-transitions.test.tsx

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
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(result.current.query.data).toBeUndefined();
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.searchIdle('mal') }),
    ).toBeDefined();
  });

  it('searches the provider with the params and the query signal, under the search key', async () => {
    const { provider, queryClient, result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(FRIEREN, expect.any(AbortSignal));
    expect(queryClient.getQueryData(queryKeys.search('mal', FRIEREN))).toStrictEqual(pageOf(CLEAN));
    expect(result.current.query.data).toStrictEqual({ ...pageOf(CLEAN), hiddenCount: 0 });
  });

  it('keeps unused searches in memory for SEARCH_GC_TIME', async () => {
    const { queryClient, result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    const query = queryClient.getQueryCache().find({ queryKey: queryKeys.search('mal', FRIEREN) });

    expect(query?.gcTime).toBe(SEARCH_GC_TIME);
  });

  it('keeps results fresh for STALE_TIMES.search', async () => {
    const { result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    // read before the time passes, so the hook re-renders when it changes
    expect(result.current.query.isStale).toBe(false);
    const freshUntil = result.current.query.dataUpdatedAt + STALE_TIMES.search;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(freshUntil - Date.now() - 1);
    });

    expect(result.current.query.isStale).toBe(false);

    // the observer marks the data stale on a timer of its own, a millisecond after the stale time
    await waitFor(() => {
      expect(result.current.query.isStale).toBe(true);
    });
  });

  it('hides adult titles and counts them with adult content off (BR-06)', async () => {
    const { result } = setup(FRIEREN, resolvesWith(pageOf(CLEAN, ADULT)));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);
    expect(result.current.query.data?.hiddenCount).toBe(1);
  });

  it('filters the cached page again without a refetch when the setting changes', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN, ADULT)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    rerender({ params: FRIEREN, showAdult: true });

    expect(result.current.query.data?.items).toStrictEqual([CLEAN, ADULT]);
    expect(result.current.query.data?.hiddenCount).toBe(0);

    rerender({ params: FRIEREN, showAdult: false });

    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(result.current.query.isFetching).toBe(false);
  });

  it('surfaces a provider error after a single call, never retrying', async () => {
    const error = new CatalogNetworkError();
    const { provider, result } = setup(FRIEREN, rejectsWith(error));

    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STALE_TIMES.search);
    });

    expect(result.current.query.error).toBe(error);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it('searches again on refetch', async () => {
    const { provider, result } = setup(FRIEREN, rejectsWith(new CatalogNetworkError()));
    await waitFor(() => {
      expect(result.current.query.isError).toBe(true);
    });
    provider.search.mockResolvedValue(pageOf(CLEAN));

    await act(async () => {
      await result.current.query.refetch();
    });

    await waitFor(() => {
      expect(result.current.query.data?.items).toStrictEqual([CLEAN]);
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
