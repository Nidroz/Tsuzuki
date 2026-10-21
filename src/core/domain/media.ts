// a media is a catalog title identified by (namespace, kind, externalId), see SPEC.md
import { POSTGRES_INTEGER_MAX } from './database-limits';

/** the kinds of media the catalog serves. */
export const MEDIA_KINDS = ['anime', 'manga'] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * whose catalog ids `externalId` holds. `mal` = MyAnimeList ids, served by every
 * Jikan v4 compatible instance (Tenrai, a self-hosted Jikan).
 */
export const MEDIA_ID_NAMESPACES = ['mal'] as const;

/** the id namespace of a media key. */
export type MediaIdNamespace = (typeof MEDIA_ID_NAMESPACES)[number];

/** the canonical identity of a media, independent of the server that serves it. */
export interface MediaKey {
  readonly namespace: MediaIdNamespace;
  readonly kind: MediaKind;
  readonly externalId: number;
}

// the rank of a value in its ordered list, the order of its postgres enum
const rankOf = (values: readonly string[], value: string): number => values.indexOf(value);

/**
 * the media key order: namespace then kind in the order of MEDIA_ID_NAMESPACES and MEDIA_KINDS
 * (the postgres enum order), then externalId, ascending. 0 only for the same media.
 */
export const compareMediaKeys = (a: MediaKey, b: MediaKey): number =>
  rankOf(MEDIA_ID_NAMESPACES, a.namespace) - rankOf(MEDIA_ID_NAMESPACES, b.namespace) ||
  rankOf(MEDIA_KINDS, a.kind) - rankOf(MEDIA_KINDS, b.kind) ||
  a.externalId - b.externalId;

// the postgres integer bound of library_entries.external_id, docs/ARCHITECTURE.md §5
export const EXTERNAL_ID_MAX = POSTGRES_INTEGER_MAX;

/** whether a string is exactly one of the media kinds (case-sensitive, no trimming). */
export const isMediaKind = (value: string): value is MediaKind =>
  MEDIA_KINDS.some((kind) => kind === value);

/** anime formats (SPEC.md §2); `unknown` is the adapter fallback for an unknown provider type. */
export const ANIME_FORMATS = ['tv', 'movie', 'ova', 'ona', 'special', 'music', 'unknown'] as const;

export type AnimeFormat = (typeof ANIME_FORMATS)[number];

/** manga formats (SPEC.md §2); `unknown` is the adapter fallback for an unknown provider type. */
export const MANGA_FORMATS = [
  'manga',
  'manhwa',
  'manhua',
  'light_novel',
  'novel',
  'one_shot',
  'doujinshi',
  'oel',
  'unknown',
] as const;

export type MangaFormat = (typeof MANGA_FORMATS)[number];

export type MediaFormat = AnimeFormat | MangaFormat;

/** every media format once: the anime formats, then the manga formats, `unknown` last. */
export const MEDIA_FORMATS = [
  'tv',
  'movie',
  'ova',
  'ona',
  'special',
  'music',
  'manga',
  'manhwa',
  'manhua',
  'light_novel',
  'novel',
  'one_shot',
  'doujinshi',
  'oel',
  'unknown',
] as const satisfies readonly MediaFormat[];

/** every format of each kind, `unknown` included; search uses SEARCHABLE_FORMATS_BY_KIND. */
export const MEDIA_FORMATS_BY_KIND: {
  readonly anime: readonly AnimeFormat[];
  readonly manga: readonly MangaFormat[];
} = { anime: ANIME_FORMATS, manga: MANGA_FORMATS };

/**
 * the anime formats a search can filter on (FR-03), in ANIME_FORMATS order: every anime format but
 * `unknown`, the adapter fallback, which no provider search type matches.
 */
export const SEARCHABLE_ANIME_FORMATS = [
  'tv',
  'movie',
  'ova',
  'ona',
  'special',
  'music',
] as const satisfies readonly Exclude<AnimeFormat, 'unknown'>[];

export type SearchableAnimeFormat = (typeof SEARCHABLE_ANIME_FORMATS)[number];

/**
 * the manga formats a search can filter on (FR-03), in MANGA_FORMATS order: every manga format but
 * `oel` and `unknown`, which have no provider search type.
 */
export const SEARCHABLE_MANGA_FORMATS = [
  'manga',
  'manhwa',
  'manhua',
  'light_novel',
  'novel',
  'one_shot',
  'doujinshi',
] as const satisfies readonly Exclude<MangaFormat, 'oel' | 'unknown'>[];

export type SearchableMangaFormat = (typeof SEARCHABLE_MANGA_FORMATS)[number];

/** a format a search can filter on, of either kind. */
export type SearchableMediaFormat = SearchableAnimeFormat | SearchableMangaFormat;

/** the searchable formats of each kind: the format chips of the search filters, single-select. */
export const SEARCHABLE_FORMATS_BY_KIND: {
  readonly anime: readonly SearchableAnimeFormat[];
  readonly manga: readonly SearchableMangaFormat[];
} = { anime: SEARCHABLE_ANIME_FORMATS, manga: SEARCHABLE_MANGA_FORMATS };

// publication status of the title, never a library status (current, planned, completed, paused, dropped)
export const MEDIA_STATUSES = [
  'ongoing',
  'finished',
  'upcoming',
  'hiatus',
  'discontinued',
] as const;

export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** the publication statuses a search can filter on (FR-03). */
export const SEARCHABLE_MEDIA_STATUSES = [
  'ongoing',
  'finished',
  'upcoming',
] as const satisfies readonly MediaStatus[];

export type SearchableMediaStatus = (typeof SEARCHABLE_MEDIA_STATUSES)[number];
