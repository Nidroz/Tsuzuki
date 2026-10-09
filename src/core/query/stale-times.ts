// cache durations of docs/ARCHITECTURE.md §6, in milliseconds

const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTE_MS = SECONDS_PER_MINUTE * SECOND_MS;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;

const MEDIA_DETAIL_HOURS = 24;
const RANKING_HOURS = 6;
const SEARCH_MINUTES = 10;
const GENRES_DAYS = 7;
const PERSISTED_CACHE_DAYS = 7;

/** how long fetched data stays fresh before a refetch, per query family. */
export const STALE_TIMES = {
  mediaDetail: MEDIA_DETAIL_HOURS * HOUR_MS,
  top: RANKING_HOURS * HOUR_MS,
  season: RANKING_HOURS * HOUR_MS,
  search: SEARCH_MINUTES * MINUTE_MS,
  genres: GENRES_DAYS * DAY_MS,
  // the library is always revalidated
  library: 0,
} as const;

/**
 * age after which a persisted query cache is dropped on restore.
 * at least the longest stale time, so persisted data is never dropped while still fresh.
 */
export const PERSISTED_CACHE_MAX_AGE = PERSISTED_CACHE_DAYS * DAY_MS;
