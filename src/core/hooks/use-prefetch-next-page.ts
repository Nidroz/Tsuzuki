import { hashKey, useQueryClient, type QueryState } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { CatalogPageList } from './use-paged-catalog-list';

/** what the next page prefetch needs to know of the page shown */
export interface ShownPageState {
  /** the page shown has a page after it; undefined without data */
  readonly hasNextPage: boolean | undefined;
  /** the page shown belongs to another key while this one loads */
  readonly isPlaceholderData: boolean;
  readonly isFetching: boolean;
  /** when the data of the page shown was last updated */
  readonly dataUpdatedAt: number;
}

// the next page of a list has to be fetched: it has no data, data older than the list's stale
// time or invalidated data, and no request of its own in flight
const needsFetch = (state: QueryState | undefined, staleTime: number): boolean =>
  state === undefined ||
  (state.fetchStatus !== 'fetching' &&
    (state.data === undefined ||
      state.isInvalidated ||
      Date.now() - state.dataUpdatedAt >= staleTime));

/**
 * fetches the page after `page` of `list` in the background once the page shown is settled: its
 * own data, not fetching, with a next page that has no fresh data. the page is written to the
 * cache only when nothing newer reached it meanwhile. not `prefetchQuery`: it would put the next
 * query in a fetching state, so a page opened meanwhile would wait on the background request,
 * which tanstack query cannot promote; with a direct call, the opened page's own foreground
 * request joins the background one at the http client and promotes it. a prefetch is aborted when
 * the list changes (the hash of its list key) or on unmount, never when only the page changes: the
 * opened page's request has to join it. one attempt per target and per data update of the page
 * shown, so a failed prefetch is never retried in a loop. null prefetches nothing
 */
export const usePrefetchNextPage = (
  list: CatalogPageList | null,
  page: number,
  { hasNextPage, isPlaceholderData, isFetching, dataUpdatedAt }: ShownPageState,
): void => {
  const queryClient = useQueryClient();
  const listHash = list === null ? null : hashKey(list.listKey);

  // the target and the data update of the page shown of the last attempt
  const attemptRef = useRef<string | null>(null);

  // one controller per list: declared before the prefetch effect, so a new list aborts the
  // prefetch of the previous one before it starts its own. an aborted attempt may run again
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => {
      controller.abort();
      attemptRef.current = null;
    };
  }, [listHash]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (
      list === null ||
      controller === null ||
      hasNextPage !== true ||
      isPlaceholderData ||
      isFetching
    ) {
      return;
    }
    const nextPage = page + 1;
    const nextKey = list.pageKey(nextPage);
    const attempt = `${hashKey(nextKey)}@${String(dataUpdatedAt)}`;
    if (
      attemptRef.current === attempt ||
      !needsFetch(queryClient.getQueryState(nextKey), list.staleTime)
    ) {
      return;
    }
    attemptRef.current = attempt;
    const startedAt = Date.now();
    list.fetchPage(nextPage, controller.signal, { priority: 'background' }).then(
      (fetched) => {
        const latest = queryClient.getQueryState(nextKey);
        if (latest?.data === undefined || latest.dataUpdatedAt < startedAt) {
          queryClient.setQueryData(nextKey, fetched);
        }
      },
      () => {
        // dropped on purpose: an abort is expected (the list changed or the screen left), any
        // other failure is already counted by the catalog failure monitor, and the page loads
        // normally, with its own error state, when it is opened
      },
    );
  }, [list, page, hasNextPage, isPlaceholderData, isFetching, dataUpdatedAt, queryClient]);
};
