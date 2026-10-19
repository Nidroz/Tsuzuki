import { useMemo } from 'react';

import type { CatalogProvider, TopParams } from '../catalog/catalog-provider';
import type { MediaKind, SearchableMediaFormat } from '../domain/media';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';
import {
  LIST_KEY_PAGE,
  usePagedCatalogList,
  type CatalogListOptions,
  type CatalogPageList,
  type PagedCatalogListResult,
} from './use-paged-catalog-list';

export type UseTopMediaOptions = CatalogListOptions;

/** the top list asked for: TopParams with an explicit null for every format */
export interface UseTopMediaParams {
  readonly kind: MediaKind;
  /** one format of the kind (the FR-05 chips), null for every format */
  readonly format: SearchableMediaFormat | null;
  // 1-based
  readonly page: number;
}

// no format key without a format (exactOptionalPropertyTypes)
const topParams = (
  kind: MediaKind,
  format: SearchableMediaFormat | null,
  page: number,
): TopParams => (format === null ? { kind, page } : { kind, format, page });

// the pages of the top list of a kind, of one format or of every format
const topList = (
  provider: CatalogProvider,
  kind: MediaKind,
  format: SearchableMediaFormat | null,
): CatalogPageList => ({
  listKey: queryKeys.top(provider.namespace, topParams(kind, format, LIST_KEY_PAGE)),
  pageKey: (page) => queryKeys.top(provider.namespace, topParams(kind, format, page)),
  fetchPage: (page, ...request) => provider.getTop(topParams(kind, format, page), ...request),
  staleTime: STALE_TIMES.top,
});

/**
 * one page of the top list of `params` (FR-05, usePagedCatalogList). while another page of the
 * same list loads, the page before stays as placeholder data; another kind or format starts
 * without one
 */
export const useTopMedia = (
  { kind, format, page }: UseTopMediaParams,
  { showAdult }: UseTopMediaOptions,
): PagedCatalogListResult => {
  const provider = useCatalogProvider();
  const list = useMemo(() => topList(provider, kind, format), [provider, kind, format]);
  return usePagedCatalogList({ list, page }, { showAdult, placeholder: 'same-list' });
};
