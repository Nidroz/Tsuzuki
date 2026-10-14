// a media is a catalog title identified by (namespace, kind, externalId), see SPEC.md

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

// the postgres integer bound of library_entries.external_id, docs/ARCHITECTURE.md §5
export const EXTERNAL_ID_MAX = 2_147_483_647;

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

/** the formats offered for each kind, e.g. the search format filter. */
export const MEDIA_FORMATS_BY_KIND: {
  readonly anime: readonly AnimeFormat[];
  readonly manga: readonly MangaFormat[];
} = { anime: ANIME_FORMATS, manga: MANGA_FORMATS };

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
