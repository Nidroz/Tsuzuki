import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Genre } from '../catalog/catalog-provider';
import type { MediaKind } from '../domain/media';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';

export interface UseGenresOptions {
  /** false: nothing is fetched, the cached genres (if any) are still returned. true by default */
  readonly enabled?: boolean;
}

/**
 * the genres of `kind` from the catalog provider (FR-03), adult genres included: the filters sheet
 * hides them itself (BR-06). fetched when first needed and `enabled`, then served from the cache
 * for STALE_TIMES.genres. never retried here: the catalog http client retries
 */
export const useGenres = (
  kind: MediaKind,
  { enabled = true }: UseGenresOptions = {},
): UseQueryResult<readonly Genre[]> => {
  const provider = useCatalogProvider();
  return useQuery({
    queryKey: queryKeys.genres(provider.namespace, kind),
    queryFn: ({ signal }) => provider.getGenres(kind, signal),
    staleTime: STALE_TIMES.genres,
    enabled,
  });
};
