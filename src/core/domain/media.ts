// a media is a catalog title identified by (kind, providerId), see SPEC.md

/** the kinds of media the catalog serves. */
export const MEDIA_KINDS = ['anime', 'manga'] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/** canonical identity of a media across providers. */
export interface MediaKey {
  kind: MediaKind;
  // canonical id: jikan uses it natively, anilist exposes idMal
  malId: number;
}

// the postgres integer bound of library_entries.mal_id, docs/ARCHITECTURE.md §5
export const MAL_ID_MAX = 2_147_483_647;

/** whether a string is exactly one of the media kinds (case-sensitive, no trimming). */
export const isMediaKind = (value: string): value is MediaKind =>
  MEDIA_KINDS.some((kind) => kind === value);
