// the rendered useSearch hook on a fake provider, with its params and pages, for the use-search tests
import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

import {
  createFakeCatalogProvider,
  EMPTY_PAGE,
} from '../../catalog/__fixtures__/fake-catalog-provider';
import type {
  CatalogProvider,
  MediaSummary,
  Page,
  SearchParams,
} from '../../catalog/catalog-provider';
import { createQueryClient } from '../../query/query-client';
import { useSearch } from '../use-search';
import { hookWrapper, pendingUntilAborted, summaryOf } from './catalog-pages';

export type Search = CatalogProvider['search'];

export const FRIEREN: SearchParams = { kind: 'anime', query: 'frieren', page: 1 };
export const MUSHISHI: SearchParams = { kind: 'anime', query: 'mushishi', page: 1 };
export const FRIEREN_MANGA: SearchParams = { kind: 'manga', query: 'frieren', page: 1 };
export const MONONOKE: SearchParams = { kind: 'anime', query: 'mononoke', page: 1 };
export const CLEAN = summaryOf(1);
export const ADULT = summaryOf(2, 'anime', true);
export const OTHER = summaryOf(3);

/** a single page holding `items` */
export const pageOf = (...items: MediaSummary[]): Page<MediaSummary> => ({ ...EMPTY_PAGE, items });

/** a search that never settles by itself: it rejects when its signal aborts */
export const searchPendingUntilAborted: Search = (_params, signal) => pendingUntilAborted(signal);

export const resolvesWith =
  (page: Page<MediaSummary>): Search =>
  () =>
    Promise.resolve(page);

export const rejectsWith =
  (error: Error): Search =>
  () =>
    Promise.reject(error);

interface HookProps {
  readonly params: SearchParams | null;
  readonly showAdult: boolean;
}

/** the provider answers with `search`, set before the first render, which starts the request */
export const setupSearch = (params: SearchParams | null, search?: Search, showAdult = false) => {
  const provider = createFakeCatalogProvider();
  if (search !== undefined) {
    provider.search.mockImplementation(search);
  }
  const queryClient: QueryClient = createQueryClient();
  const hook = renderHook(
    ({ params: current, showAdult: show }: HookProps) => useSearch(current, { showAdult: show }),
    { initialProps: { params, showAdult }, wrapper: hookWrapper(queryClient, provider) },
  );
  return { provider, queryClient, ...hook };
};
