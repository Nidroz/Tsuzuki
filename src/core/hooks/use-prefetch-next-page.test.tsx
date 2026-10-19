import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type {
  CatalogProvider,
  CatalogRequestOptions,
  MediaSummary,
  Page,
  SearchParams,
} from '../catalog/catalog-provider';
import { CatalogNetworkError } from '../errors/catalog-errors';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { STALE_TIMES } from '../query/stale-times';
import { settle } from './__fixtures__/catalog-pages';
import { CatalogContextProvider } from './CatalogContextProvider';
import { useSearch } from './use-search';

type Search = CatalogProvider['search'];

const LAST_PAGE = 3;
const BACKGROUND: CatalogRequestOptions = { priority: 'background' };

const summary = (externalId: number): MediaSummary => ({
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
  isAdult: false,
});

// page n of a search of LAST_PAGE pages, one item whose id is the page
const pageNumber = (page: number): Page<MediaSummary> => ({
  items: [summary(page)],
  page,
  lastPage: LAST_PAGE,
  hasNextPage: page < LAST_PAGE,
});

const frieren = (page: number): SearchParams => ({ kind: 'anime', query: 'frieren', page });
const MUSHISHI: SearchParams = { kind: 'anime', query: 'mushishi', page: 1 };

// a search that never settles by itself: it rejects when its signal aborts
const pendingUntilAborted: Search = (_params, signal) =>
  new Promise<Page<MediaSummary>>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

// foreground requests answer their page at once, background ones run `background`
const answering =
  (background: Search): Search =>
  (params, signal, options) =>
    options?.priority === 'background'
      ? background(params, signal, options)
      : Promise.resolve(pageNumber(params.page));

const setup = (params: SearchParams | null, search: Search) => {
  const provider = createFakeCatalogProvider();
  provider.search.mockImplementation(search);
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    ({ params: current }: { readonly params: SearchParams | null }) =>
      useSearch(current, { showAdult: false }),
    { initialProps: { params }, wrapper },
  );
  return { provider, queryClient, ...hook };
};

const backgroundCalls = (provider: ReturnType<typeof createFakeCatalogProvider>) =>
  provider.search.mock.calls.filter(([, , options]) => options?.priority === 'background');

describe('useSearch next page prefetch (C-06)', () => {
  it('prefetches the next page once in the background when idle, filling its key', async () => {
    const { provider, queryClient, result, rerender } = setup(
      frieren(1),
      answering((params) => Promise.resolve(pageNumber(params.page))),
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.search('mal', frieren(2)))).toStrictEqual(
        pageNumber(2),
      );
    });
    rerender({ params: frieren(1) });
    await settle();

    expect(result.current.query.data?.page).toBe(1);
    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(provider.search).toHaveBeenNthCalledWith(1, frieren(1), expect.any(AbortSignal));
    expect(provider.search).toHaveBeenNthCalledWith(
      2,
      frieren(2),
      expect.any(AbortSignal),
      BACKGROUND,
    );
  });

  it('opens a prefetched page from the cache, then prefetches the one after it', async () => {
    const { provider, result, rerender } = setup(
      frieren(1),
      answering((params) => Promise.resolve(pageNumber(params.page))),
    );
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    await settle();

    rerender({ params: frieren(2) });

    expect(result.current.query.data?.page).toBe(2);
    expect(result.current.query.isPlaceholderData).toBe(false);
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(2);
    });
    expect(backgroundCalls(provider)[1]?.[0]).toStrictEqual(frieren(LAST_PAGE));
    // the last page has no next page, and the prefetched pages were never asked in the foreground
    rerender({ params: frieren(LAST_PAGE) });
    await settle();
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it('prefetches nothing without a next page', async () => {
    const { provider, result } = setup(frieren(LAST_PAGE), answering(pendingUntilAborted));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    await settle();

    expect(backgroundCalls(provider)).toHaveLength(0);
  });

  it('prefetches nothing while the page shown is a placeholder or still fetching', async () => {
    const { provider, result, rerender } = setup(frieren(1), answering(pendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    provider.search.mockImplementation(pendingUntilAborted);

    rerender({ params: frieren(2) });
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.isFetching).toBe(true);
    // the foreground request of page 2, and still no prefetch of page 3
    expect(provider.search).toHaveBeenCalledTimes(3);
    expect(backgroundCalls(provider)).toHaveLength(1);
  });

  it('prefetches nothing when the next page is cached and fresh, again once it is stale', async () => {
    const { provider, queryClient, result, rerender } = setup(null, answering(pendingUntilAborted));
    queryClient.setQueryData(queryKeys.search('mal', frieren(2)), pageNumber(2));

    rerender({ params: frieren(1) });
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    await settle();

    expect(backgroundCalls(provider)).toHaveLength(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(STALE_TIMES.search);
    });
    // a refetch of the page shown is a new data update: the stale next page is fetched again
    await act(async () => {
      await result.current.query.refetch();
    });
    await settle();

    expect(backgroundCalls(provider)).toHaveLength(1);
  });

  it('keeps the prefetch running when its page is opened, so the opened request joins it', async () => {
    const { provider, rerender } = setup(frieren(1), answering(pendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];
    provider.search.mockImplementation(pendingUntilAborted);

    rerender({ params: frieren(2) });
    await settle();

    expect(provider.search).toHaveBeenLastCalledWith(frieren(2), expect.any(AbortSignal));
    expect(prefetchSignal?.aborted).toBe(false);
  });

  it('aborts the prefetch when the search changes', async () => {
    const { provider, rerender } = setup(frieren(1), answering(pendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];

    rerender({ params: MUSHISHI });
    await settle();

    expect(prefetchSignal?.aborted).toBe(true);
  });

  it('aborts the prefetch on unmount', async () => {
    const { provider, unmount } = setup(frieren(1), answering(pendingUntilAborted));
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const prefetchSignal = backgroundCalls(provider)[0]?.[1];

    unmount();

    expect(prefetchSignal?.aborted).toBe(true);
  });

  it('drops a failed prefetch without retrying it in a loop', async () => {
    const { provider, queryClient, result, rerender } = setup(
      frieren(1),
      answering(() => Promise.reject(new CatalogNetworkError())),
    );
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });

    rerender({ params: frieren(1) });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STALE_TIMES.search - 1);
    });
    rerender({ params: frieren(1) });
    await settle();

    expect(backgroundCalls(provider)).toHaveLength(1);
    expect(queryClient.getQueryState(queryKeys.search('mal', frieren(2)))).toBeUndefined();
    expect(result.current.query.data?.page).toBe(1);
    expect(result.current.query.error).toBeNull();
  });

  it('never overwrites data newer than the prefetch start', async () => {
    let answerPrefetch: (page: Page<MediaSummary>) => void = () => undefined;
    const { provider, queryClient } = setup(
      frieren(1),
      answering(
        () =>
          new Promise<Page<MediaSummary>>((resolve) => {
            answerPrefetch = resolve;
          }),
      ),
    );
    await waitFor(() => {
      expect(backgroundCalls(provider)).toHaveLength(1);
    });
    const newer = { ...pageNumber(2), items: [summary(LAST_PAGE + 1)] };
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    queryClient.setQueryData(queryKeys.search('mal', frieren(2)), newer);

    answerPrefetch(pageNumber(2));
    await settle();

    expect(queryClient.getQueryData(queryKeys.search('mal', frieren(2)))).toStrictEqual(newer);
  });
});
