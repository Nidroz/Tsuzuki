// the catalog provider contract and its normalized types, docs/ARCHITECTURE.md §3 and ADR-0003.
// adapters parse raw provider payloads with zod and map them to these types; nothing provider-specific leaks out
import type {
  MediaFormat,
  MediaIdNamespace,
  MediaKey,
  MediaKind,
  MediaStatus,
  SearchableMediaStatus,
} from '../domain/media';

/** a provider genre; the id is namespace-scoped (a mal genre id in the mal namespace). */
export interface Genre {
  readonly id: number;
  readonly name: string;
}

/** a title as listed in search, top and season results. */
export interface MediaSummary {
  readonly key: MediaKey;
  readonly title: string;
  readonly titleEnglish: string | null;
  readonly imageUrl: string | null;
  readonly format: MediaFormat;
  readonly status: MediaStatus;
  // episodes or chapters, null when unknown
  readonly totalUnits: number | null;
  readonly score: number | null;
  readonly year: number | null;
  readonly genres: readonly Genre[];
  // set by the adapter with isAdultMedia, docs/ARCHITECTURE.md §7
  readonly isAdult: boolean;
}

/** a title as shown on the detail screen. */
export interface MediaDetail extends MediaSummary {
  readonly synopsis: string | null;
  readonly titleNative: string | null;
}

/** the fields a search can be sorted by. */
export const SEARCH_SORT_FIELDS = ['score', 'popularity', 'title', 'start_date'] as const;

export type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** search filters (FR-03); an absent field does not filter. */
export interface SearchParams {
  readonly kind: MediaKind;
  readonly query?: string;
  readonly formats?: readonly MediaFormat[];
  readonly genresIncluded?: readonly number[];
  readonly genresExcluded?: readonly number[];
  readonly status?: SearchableMediaStatus;
  readonly year?: number;
  readonly minScore?: number;
  readonly sort?: { readonly field: SearchSortField; readonly direction: SortDirection };
  // 1-based
  readonly page: number;
}

/** one page of results; `page` and `lastPage` are 1-based. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly lastPage: number;
  readonly hasNextPage: boolean;
}

/** the only way to the catalog: screens and hooks never see a provider directly. */
export interface CatalogProvider {
  /**
   * the id namespace of every media key it returns and accepts;
   * catalog query keys are built from it.
   */
  readonly namespace: MediaIdNamespace;
  /**
   * a short non-personal id of the configured instance (lowercase letters, digits and hyphens),
   * e.g. for error reports and its own rate limiter; never a url, never part of a query key.
   */
  readonly instanceId: string;
  search(params: SearchParams, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getDetail(key: MediaKey, signal?: AbortSignal): Promise<MediaDetail>;
  getTop(kind: MediaKind, page: number, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getCurrentSeason(page: number, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getGenres(kind: MediaKind, signal?: AbortSignal): Promise<readonly Genre[]>;
}
