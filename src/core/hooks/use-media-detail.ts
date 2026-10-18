import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { MediaDetail } from '../catalog/catalog-provider';
import { applyContentFilter } from '../domain/content-filter';
import type { MediaKey } from '../domain/media';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';

/** a media detail as the detail screen may show it: hidden when it is adult content (BR-06) */
export type VisibleMediaDetail =
  { readonly hidden: false; readonly media: MediaDetail } | { readonly hidden: true };

export interface UseMediaDetailOptions {
  /** the adult content setting (BR-06): an adult title is hidden when false */
  readonly showAdult: boolean;
}

type SelectVisibleMediaDetail = (media: MediaDetail) => VisibleMediaDetail;

const toVisible = (media: MediaDetail, showAdult: boolean): VisibleMediaDetail =>
  applyContentFilter([media], showAdult).hiddenCount > 0
    ? { hidden: true }
    : { hidden: false, media };

// module level: one stable function per setting value, so the query reruns the selection only
// when its data or the setting changes
const keepAdult: SelectVisibleMediaDetail = (media) => toVisible(media, true);
const hideAdult: SelectVisibleMediaDetail = (media) => toVisible(media, false);

/**
 * the details of the media `key` from the catalog provider (FR-06), hidden on the cached data when
 * it is adult content and the setting is off (BR-06): toggling the setting never refetches. served
 * from the cache for STALE_TIMES.mediaDetail, and persisted like every successful query, so a
 * viewed title reads offline (until A-05, a failed offline refetch drops it from the persisted
 * cache: docs/ARCHITECTURE.md §6). a request whose key is left is aborted down to the http client.
 * never retried here: the catalog http client retries
 */
export const useMediaDetail = (
  key: MediaKey,
  { showAdult }: UseMediaDetailOptions,
): UseQueryResult<VisibleMediaDetail> => {
  const provider = useCatalogProvider();
  return useQuery({
    queryKey: queryKeys.media(key),
    queryFn: ({ signal }) => provider.getDetail(key, signal),
    staleTime: STALE_TIMES.mediaDetail,
    select: showAdult ? keepAdult : hideAdult,
  });
};
