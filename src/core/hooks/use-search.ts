import { keepPreviousData, skipToken, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { MediaSummary, SearchParams } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { SEARCH_GC_TIME, STALE_TIMES } from '../query/stale-times';
import { selectFilteredPage, type FilteredPage } from './filtered-page';
import { useCatalogProvider } from './use-catalog-provider';

/** how long the search text stays unchanged before it is searched (FR-01), in milliseconds */
export const SEARCH_DEBOUNCE_MS = 400;

export interface UseSearchOptions {
  /** the adult content setting (BR-06): adult titles are hidden when false */
  readonly showAdult: boolean;
}

/**
 * one page of catalog search results for `params`, adult titles filtered on the cached data
 * (`hiddenCount` says how many). null searches nothing: the query stays idle under its own key. a
 * request whose key is left (new text, another kind) is aborted down to the http client. the
 * previous results stay as placeholder data while a new key loads. never retried here: the catalog
 * http client retries
 */
export const useSearch = (
  params: SearchParams | null,
  { showAdult }: UseSearchOptions,
): UseQueryResult<FilteredPage<MediaSummary>> => {
  const provider = useCatalogProvider();

  return useQuery({
    queryKey:
      params === null
        ? queryKeys.searchIdle(provider.namespace)
        : queryKeys.search(provider.namespace, params),
    queryFn: params === null ? skipToken : ({ signal }) => provider.search(params, signal),
    staleTime: STALE_TIMES.search,
    gcTime: SEARCH_GC_TIME,
    placeholderData: keepPreviousData,
    select: selectFilteredPage(showAdult),
  });
};
