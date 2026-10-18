import {
  hashKey,
  skipToken,
  useQuery,
  type PlaceholderDataFunction,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import type { MediaSummary, Page, SearchParams } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { SEARCH_GC_TIME, STALE_TIMES } from '../query/stale-times';
import { selectFilteredPage, type FilteredPage } from './filtered-page';
import { useCatalogProvider } from './use-catalog-provider';
import { usePrefetchNextPage } from './use-prefetch-next-page';

/** how long the search text stays unchanged before it is searched (FR-01), in milliseconds */
export const SEARCH_DEBOUNCE_MS = 400;

export interface UseSearchOptions {
  /** the adult content setting (BR-06): adult titles are hidden when false */
  readonly showAdult: boolean;
}

/**
 * one page of catalog search results for `params`, adult titles filtered on the cached data
 * (`hiddenCount` says how many). null searches nothing: the query stays idle under its own key,
 * without data. a request whose key is left (new text, another kind) is aborted down to the http
 * client. the results of the search just before stay as placeholder data while a new key loads,
 * never across an idle state: after a cleared field, a new search starts without results. never
 * retried here: the catalog http client retries. once the page shown is settled, the next page is
 * prefetched in the background (usePrefetchNextPage)
 */
export const useSearch = (
  params: SearchParams | null,
  { showAdult }: UseSearchOptions,
): UseQueryResult<FilteredPage<MediaSummary>> => {
  const provider = useCatalogProvider();
  const queryKey =
    params === null
      ? queryKeys.searchIdle(provider.namespace)
      : queryKeys.search(provider.namespace, params);
  const keyHash = hashKey(queryKey);

  // the hash of the key of the last committed render: while a new key renders, the key before it
  const previousKeyHashRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    previousKeyHashRef.current = keyHash;
  }, [keyHash]);

  // `previousQuery` is the last query of this observer that had data, which skips the idle key (it
  // never has data): its results are kept only when it is the key just before. stable, so the
  // observer reuses the placeholder while the key stays the same
  const keepPreviousSearch = useCallback<PlaceholderDataFunction<Page<MediaSummary>>>(
    (previous, previousQuery) =>
      previousQuery?.queryHash === previousKeyHashRef.current ? previous : undefined,
    [],
  );

  const result = useQuery({
    queryKey,
    queryFn: params === null ? skipToken : ({ signal }) => provider.search(params, signal),
    staleTime: STALE_TIMES.search,
    gcTime: SEARCH_GC_TIME,
    // the idle key shows no placeholder: otherwise the next search would reuse it as its own
    ...(params !== null && { placeholderData: keepPreviousSearch }),
    select: selectFilteredPage(showAdult),
  });

  usePrefetchNextPage(params, {
    hasNextPage: result.data?.hasNextPage,
    isPlaceholderData: result.isPlaceholderData,
    isFetching: result.isFetching,
    dataUpdatedAt: result.dataUpdatedAt,
  });

  return result;
};
