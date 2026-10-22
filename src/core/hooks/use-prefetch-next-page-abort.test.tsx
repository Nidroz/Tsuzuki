import { describe, expect, it } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider } from '../catalog/catalog-provider';
import { createQueryClient } from '../query/query-client';
import {
  answering,
  BACKGROUND,
  backgroundCalls,
  frieren,
  MUSHISHI,
  searchPendingUntilAborted,
  settle,
  setupPrefetch,
} from './__fixtures__/prefetch-search';
import { CatalogContextProvider } from './CatalogContextProvider';
import { useSearch } from './use-search';

// c-06: when the next page prefetch of useSearch is aborted, and when it keeps running

describe('useSearch next page prefetch aborts (C-06)', () => {
  it('keeps the prefetch running when its page is opened, so the opened request joins it', async () => {
    const { provider, rerender } = setupPrefetch(frieren(1), answering(searchPendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];
    provider.search.mockImplementation(searchPendingUntilAborted);

    rerender({ params: frieren(2) });
    await settle();

    expect(provider.search).toHaveBeenLastCalledWith(frieren(2), expect.any(AbortSignal));
    expect(prefetchSignal?.aborted).toBe(false);
  });

  it('aborts the prefetch when the search changes', async () => {
    const { provider, rerender } = setupPrefetch(frieren(1), answering(searchPendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];

    rerender({ params: MUSHISHI });
    await settle();

    expect(prefetchSignal?.aborted).toBe(true);
  });

  it('aborts the prefetch and runs it again on the new catalog provider', async () => {
    const first = createFakeCatalogProvider();
    const second = createFakeCatalogProvider();
    first.search.mockImplementation(answering(searchPendingUntilAborted));
    second.search.mockImplementation(answering(searchPendingUntilAborted));
    const queryClient = createQueryClient();
    // the same namespace: the list key alone does not tell the providers apart
    let provider: CatalogProvider = first;
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
      </QueryClientProvider>
    );
    const { rerender } = renderHook(() => useSearch(frieren(1), { showAdult: false }), {
      wrapper,
    });
    await waitFor(() => {
      expect(backgroundCalls(first)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(first)[0]?.[1];

    provider = second;
    rerender();
    await settle();

    expect(prefetchSignal?.aborted).toBe(true);
    expect(backgroundCalls(second)).toStrictEqual([
      [frieren(2), expect.any(AbortSignal), BACKGROUND],
    ]);
  });

  it('aborts the prefetch on unmount', async () => {
    const { provider, unmount } = setupPrefetch(frieren(1), answering(searchPendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];

    unmount();

    expect(prefetchSignal?.aborted).toBe(true);
  });
});
