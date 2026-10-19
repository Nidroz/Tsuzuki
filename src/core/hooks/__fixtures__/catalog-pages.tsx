// pages of synthetic summaries and a hook wrapper, for the tests of the paged catalog list hooks
import { jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { CatalogProvider, MediaSummary, Page } from '../../catalog/catalog-provider';
import type { MediaKind } from '../../domain/media';
import { CatalogContextProvider } from '../CatalogContextProvider';

/** the last page of the lists of pageNumber */
export const LAST_PAGE = 3;

/** a clean synthetic summary of `kind` with the given id, adult when `isAdult` */
export const summaryOf = (
  externalId: number,
  kind: MediaKind = 'anime',
  isAdult = false,
): MediaSummary => ({
  key: { namespace: 'mal', kind, externalId },
  title: `Title ${String(externalId)}`,
  titleEnglish: null,
  imageUrl: null,
  format: kind === 'anime' ? 'tv' : 'manga',
  status: 'finished',
  totalUnits: null,
  score: null,
  year: null,
  genres: [],
  isAdult,
});

/** page n of a list of LAST_PAGE pages: one item whose id is `idBase` + n */
export const pageNumber = (page: number, idBase = 0): Page<MediaSummary> => ({
  items: [summaryOf(idBase + page)],
  page,
  lastPage: LAST_PAGE,
  hasNextPage: page < LAST_PAGE,
});

/** a request that never settles by itself: it rejects when its signal aborts */
export const pendingUntilAborted = (signal?: AbortSignal): Promise<Page<MediaSummary>> =>
  new Promise<Page<MediaSummary>>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });

/** a request that settles with the page the test answers, once it started */
export const pageAnsweredByTest = () => {
  let settle: (page: Page<MediaSummary>) => void = () => undefined;
  const request = (): Promise<Page<MediaSummary>> =>
    new Promise<Page<MediaSummary>>((resolve) => {
      settle = resolve;
    });
  const answer = (page: Page<MediaSummary>): void => {
    settle(page);
  };
  return { request, answer };
};

/** the wrapper of renderHook: the query client, then the catalog provider */
export const hookWrapper = (queryClient: QueryClient, provider: CatalogProvider) =>
  function HookWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
      </QueryClientProvider>
    );
  };

/** lets the queries, their notifications and the prefetch settle */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};
