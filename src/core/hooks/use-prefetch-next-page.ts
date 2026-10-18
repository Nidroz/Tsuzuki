import { hashKey, useQueryClient, type QueryState } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { SearchParams } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';

// the page put in a search key to compare searches whatever their page
const ANY_PAGE = 0;

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

// the next page of a search has to be fetched: it has no data, stale data or invalidated data,
// and no request of its own in flight
const needsFetch = (state: QueryState | undefined): boolean =>
  state === undefined ||
  (state.fetchStatus !== 'fetching' &&
    (state.data === undefined ||
      state.isInvalidated ||
      Date.now() - state.dataUpdatedAt >= STALE_TIMES.search));

/**
 * fetches the page after `params` in the background once the page shown is settled: its own data,
 * not fetching, with a next page that has no fresh data. the page is written to the cache only when
 * nothing newer reached it meanwhile. not `prefetchQuery`: it would put the next query in a
 * fetching state, so a page opened meanwhile would wait on the background request, which tanstack
 * query cannot promote; with a direct call, the opened page's own foreground request joins the
 * background one at the http client and promotes it. a prefetch is aborted when the search changes
 * (its params other than the page) or on unmount, never when only the page changes: the opened
 * page's request has to join it. one attempt per target and per data update of the page shown, so
 * a failed prefetch is never retried in a loop
 */
export const usePrefetchNextPage = (
  params: SearchParams | null,
  { hasNextPage, isPlaceholderData, isFetching, dataUpdatedAt }: ShownPageState,
): void => {
  const provider = useCatalogProvider();
  const queryClient = useQueryClient();
  const searchHash =
    params === null
      ? null
      : hashKey(queryKeys.search(provider.namespace, { ...params, page: ANY_PAGE }));

  // the target and the data update of the page shown of the last attempt
  const attemptRef = useRef<string | null>(null);

  // one controller per search: declared before the prefetch effect, so a new search aborts the
  // prefetch of the previous one before it starts its own. an aborted attempt may run again
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => {
      controller.abort();
      attemptRef.current = null;
    };
  }, [searchHash, provider]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (
      params === null ||
      controller === null ||
      hasNextPage !== true ||
      isPlaceholderData ||
      isFetching
    ) {
      return;
    }
    const next: SearchParams = { ...params, page: params.page + 1 };
    const nextKey = queryKeys.search(provider.namespace, next);
    const attempt = `${hashKey(nextKey)}@${String(dataUpdatedAt)}`;
    if (attemptRef.current === attempt || !needsFetch(queryClient.getQueryState(nextKey))) {
      return;
    }
    attemptRef.current = attempt;
    const startedAt = Date.now();
    provider.search(next, controller.signal, { priority: 'background' }).then(
      (page) => {
        const latest = queryClient.getQueryState(nextKey);
        if (latest?.data === undefined || latest.dataUpdatedAt < startedAt) {
          queryClient.setQueryData(nextKey, page);
        }
      },
      () => {
        // dropped on purpose: an abort is expected (the search changed or the screen left), any
        // other failure is already counted by the catalog failure monitor, and the page loads
        // normally, with its own error state, when it is opened
      },
    );
  }, [params, hasNextPage, isPlaceholderData, isFetching, dataUpdatedAt, provider, queryClient]);
};
