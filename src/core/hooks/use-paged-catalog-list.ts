// one page of a paged catalog list (search, top, season), docs/ARCHITECTURE.md §6 "Catalog lists"
import {
  hashKey,
  skipToken,
  useQuery,
  type PlaceholderDataFunction,
  type QueryKey,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CatalogRequestOptions, MediaSummary, Page } from '../catalog/catalog-provider';
import { selectFilteredPage, type FilteredPage } from './filtered-page';
import { usePrefetchNextPage } from './use-prefetch-next-page';

/** the page of the key of a whole list: no real page has it, pages are 1-based */
export const LIST_KEY_PAGE = 0;

/** a paged catalog list: how to key, fetch and cache each of its pages */
export interface CatalogPageList {
  /** equal for every page of the list, different for any other list */
  readonly listKey: QueryKey;
  /** the query key of a page of the list */
  readonly pageKey: (page: number) => QueryKey;
  /** asks the provider for a page, with the signal and the request options given */
  readonly fetchPage: (
    page: number,
    signal: AbortSignal,
    options?: CatalogRequestOptions,
  ) => Promise<Page<MediaSummary>>;
  /** how long a fetched page stays fresh */
  readonly staleTime: number;
}

/** the page of a list to show, or nothing to fetch under `idleKey` */
export type CatalogPageRequest =
  | { readonly list: CatalogPageList; readonly page: number }
  | { readonly list: null; readonly idleKey: QueryKey };

/**
 * which data stays shown while a new key loads: the key just before whatever its list
 * (`previous-key`), or the key just before only when it belongs to the same list (`same-list`)
 */
export type CatalogListPlaceholder = 'previous-key' | 'same-list';

export interface UsePagedCatalogListOptions {
  /** the adult content setting (BR-06): adult titles are hidden when false */
  readonly showAdult: boolean;
  readonly placeholder: CatalogListPlaceholder;
}

/** the options of the hooks over usePagedCatalogList */
export type CatalogListOptions = Pick<UsePagedCatalogListOptions, 'showAdult'>;

export interface PagedCatalogListResult {
  /** the tanstack result, kept whole so its tracked properties still apply */
  readonly query: UseQueryResult<FilteredPage<MediaSummary>>;
  /**
   * the placeholder shown belongs to another list (the search before): its `lastPage` is not the
   * current list's. always false with the `same-list` placeholder
   */
  readonly isPlaceholderFromOtherList: boolean;
}

/** the key and the list of the last committed render */
interface CommittedKey {
  readonly keyHash: string;
  readonly listHash: string | null;
}

/**
 * one page of a paged catalog list, adult titles filtered on the cached data (`hiddenCount` says
 * how many). an idle request fetches nothing and shows no placeholder. a request whose key is left
 * is aborted down to the http client. never retried here: the catalog http client retries. once
 * the page shown is settled, the next page is prefetched in the background (usePrefetchNextPage)
 */
export const usePagedCatalogList = (
  request: CatalogPageRequest,
  { showAdult, placeholder }: UsePagedCatalogListOptions,
): PagedCatalogListResult => {
  const { list } = request;
  const page = request.list === null ? LIST_KEY_PAGE : request.page;
  const queryKey = request.list === null ? request.idleKey : request.list.pageKey(request.page);
  const keyHash = hashKey(queryKey);
  const listHash = list === null ? null : hashKey(list.listKey);

  // while a new key renders, the key before it
  const committedRef = useRef<CommittedKey | null>(null);
  useEffect(() => {
    committedRef.current = { keyHash, listHash };
  }, [keyHash, listHash]);

  // `previousQuery` is the last query of this observer that had data, which skips keys without
  // data (the idle key, a failed page): its data is kept only when it is the key just before.
  // tanstack reuses the placeholder shown while `placeholderData` stays the same function: with
  // `previous-key` one function for every list, so the results of a search stay shown across
  // several pending searches; with `same-list` one per list, so another list never reuses them
  const sameList = placeholder === 'same-list' ? listHash : null;
  const keepPrevious = useCallback<PlaceholderDataFunction<Page<MediaSummary>>>(
    (previous, previousQuery) => {
      const before = committedRef.current;
      return before !== null &&
        previousQuery?.queryHash === before.keyHash &&
        (sameList === null || before.listHash === sameList)
        ? previous
        : undefined;
    },
    [sameList],
  );

  const query = useQuery({
    queryKey,
    queryFn: list === null ? skipToken : ({ signal }) => list.fetchPage(page, signal),
    // the idle key shows no placeholder: otherwise the next request would reuse it as its own
    ...(list !== null && { staleTime: list.staleTime, placeholderData: keepPrevious }),
    select: selectFilteredPage(showAdult),
  });

  // the list of the last page shown with its own data: a placeholder comes from it. stored
  // information from the previous render, adjusted while rendering
  const [shownListHash, setShownListHash] = useState<string | null>(null);
  const hasOwnData = query.data !== undefined && !query.isPlaceholderData;
  if (hasOwnData && shownListHash !== listHash) {
    setShownListHash(listHash);
  }

  usePrefetchNextPage(list, page, {
    hasNextPage: query.data?.hasNextPage,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    dataUpdatedAt: query.dataUpdatedAt,
  });

  return {
    query,
    isPlaceholderFromOtherList:
      placeholder === 'previous-key' && query.isPlaceholderData && shownListHash !== listHash,
  };
};
