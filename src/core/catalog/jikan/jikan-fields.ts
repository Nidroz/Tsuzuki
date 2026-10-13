// jikan v4 field values, from its published openapi spec (the anime and manga resources), and
// their normalization to the domain types. a display field never fails a response: an unexpected
// value becomes null or the `unknown` format
import type { AnimeFormat, MangaFormat, MediaFormat, MediaStatus } from '../../domain/media';

/** anime airing statuses; any other value, null included, fails the response. */
export const JIKAN_ANIME_STATUSES = [
  'Finished Airing',
  'Currently Airing',
  'Not yet aired',
] as const;

/** manga publishing statuses; any other value, null included, fails the response. */
export const JIKAN_MANGA_STATUSES = [
  'Finished',
  'Publishing',
  'On Hiatus',
  'Discontinued',
  'Not yet published',
] as const;

export const ANIME_STATUS_BY_JIKAN = {
  'Finished Airing': 'finished',
  'Currently Airing': 'ongoing',
  'Not yet aired': 'upcoming',
} as const satisfies Record<(typeof JIKAN_ANIME_STATUSES)[number], MediaStatus>;

export const MANGA_STATUS_BY_JIKAN = {
  Finished: 'finished',
  Publishing: 'ongoing',
  'On Hiatus': 'hiatus',
  Discontinued: 'discontinued',
  'Not yet published': 'upcoming',
} as const satisfies Record<(typeof JIKAN_MANGA_STATUSES)[number], MediaStatus>;

// the documented anime and manga `type` values
type JikanAnimeType =
  'TV' | 'OVA' | 'Movie' | 'Special' | 'ONA' | 'Music' | 'CM' | 'PV' | 'TV Special';

type JikanMangaType =
  'Manga' | 'Novel' | 'Light Novel' | 'One-shot' | 'Doujinshi' | 'Manhua' | 'Manhwa' | 'OEL';

const UNKNOWN_FORMAT = 'unknown' satisfies MediaFormat;

// commercials and promotional videos are not formats the app offers
const ANIME_FORMAT_BY_JIKAN_TYPE = {
  TV: 'tv',
  OVA: 'ova',
  Movie: 'movie',
  Special: 'special',
  ONA: 'ona',
  Music: 'music',
  CM: UNKNOWN_FORMAT,
  PV: UNKNOWN_FORMAT,
  'TV Special': 'special',
} as const satisfies Record<JikanAnimeType, AnimeFormat>;

const MANGA_FORMAT_BY_JIKAN_TYPE = {
  Manga: 'manga',
  Novel: 'novel',
  'Light Novel': 'light_novel',
  'One-shot': 'one_shot',
  Doujinshi: 'doujinshi',
  Manhua: 'manhua',
  Manhwa: 'manhwa',
  OEL: 'oel',
} as const satisfies Record<JikanMangaType, MangaFormat>;

// maps, not object lookups: a provider string such as "constructor" must not reach the prototype
const ANIME_FORMATS = new Map<string, MediaFormat>(Object.entries(ANIME_FORMAT_BY_JIKAN_TYPE));
const MANGA_FORMATS = new Map<string, MediaFormat>(Object.entries(MANGA_FORMAT_BY_JIKAN_TYPE));

/** the format of an anime `type`: null or an unrecognized type gives `unknown`. */
export const animeFormatOf = (type: string | null): MediaFormat =>
  (type === null ? undefined : ANIME_FORMATS.get(type)) ?? UNKNOWN_FORMAT;

/** the format of a manga `type`: null or an unrecognized type gives `unknown`. */
export const mangaFormatOf = (type: string | null): MediaFormat =>
  (type === null ? undefined : MANGA_FORMATS.get(type)) ?? UNKNOWN_FORMAT;

/** the `titles[]` entry types read by the adapter. */
export const JIKAN_TITLE_TYPES = {
  default: 'Default',
  english: 'English',
  native: 'Japanese',
} as const;

export interface JikanTitleEntry {
  readonly type: string;
  readonly title: string;
}

/** the trimmed text, or null when it is missing or blank. */
export const textOrNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** the first non-blank `titles[]` entry of `type`, else the non-blank deprecated field, else null. */
export const titleOf = (
  titles: readonly JikanTitleEntry[],
  type: string,
  deprecatedField: string | null,
): string | null => {
  for (const entry of titles) {
    const title = entry.type === type ? textOrNull(entry.title) : null;
    if (title !== null) {
      return title;
    }
  }
  return textOrNull(deprecatedField);
};

// the postgres integer bound of library_entries.media_total_units, docs/ARCHITECTURE.md §5
const TOTAL_UNITS_MAX = 2_147_483_647;

/** an episode or chapter count: a positive integer the database accepts, else null (unknown). */
export const unitCountOf = (value: number | null): number | null =>
  value !== null && Number.isInteger(value) && value > 0 && value <= TOTAL_UNITS_MAX ? value : null;

// mal scores run from 1 to 10; jikan sends 0 or null for an unscored title
const SCORE_MAX = 10;

/** a score in (0, 10], else null. */
export const scoreOf = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) && value > 0 && value <= SCORE_MAX ? value : null;

const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

/** whether `value` is a four-digit year. */
export const isFourDigitYear = (value: number): boolean =>
  Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX;

/** the first of `candidates` that is a four-digit year, else null. */
export const yearOf = (...candidates: readonly (number | null)[]): number | null =>
  candidates.find((value) => value !== null && isFourDigitYear(value)) ?? null;
