// a library entry: one media in the user's library, with its per-user snapshot (ADR-0009),
// favorites rule BR-05, the score and notes rule BR-07 and the BR-09 write convention shared by
// every library mutation
import { codePointLength, isStorableText } from './database-limits';
import type { MediaFormat, MediaKey } from './media';

/** the library statuses, in the order of the `library_status` enum (docs/ARCHITECTURE.md §5). */
export const LIBRARY_STATUSES = ['current', 'planned', 'completed', 'paused', 'dropped'] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/** whether a string is exactly one of the library statuses (case-sensitive, no trimming). */
export const isLibraryStatus = (value: string): value is LibraryStatus =>
  LIBRARY_STATUSES.some((status) => status === value);

/** the status of a new entry, the column default of library_entries.status. */
export const DEFAULT_LIBRARY_STATUS: LibraryStatus = 'planned';

/** the lowest score (BR-07, library_entries_score_check). */
export const SCORE_MIN = 1;

/** the highest score (BR-07, library_entries_score_check). */
export const SCORE_MAX = 10;

/** the longest notes, in code points as postgres char_length counts them (BR-07). */
export const NOTES_MAX_LENGTH = 2000;

/**
 * whether a score is valid (BR-07): null (no score) or an integer in SCORE_MIN..SCORE_MAX. NaN,
 * infinities and fractions are invalid.
 */
export const isValidScore = (score: number | null): boolean =>
  score === null || (Number.isInteger(score) && score >= SCORE_MIN && score <= SCORE_MAX);

/**
 * whether notes are valid (BR-07): null (no notes) or storable text (isStorableText: no NUL, no
 * lone surrogate) of at most NOTES_MAX_LENGTH code points. an empty string is valid, as the
 * database accepts it; turning blank notes into null is a choice of the notes editor (L-03), not
 * a validity rule.
 */
export const isValidNotes = (notes: string | null): boolean =>
  notes === null || (codePointLength(notes) <= NOTES_MAX_LENGTH && isStorableText(notes));

/** a calendar day `YYYY-MM-DD`, stored in a postgres `date` column. */
export type CalendarDate = string;

/** the clock of one library write, so the rules stay pure and deterministic. */
export interface LibraryWriteContext {
  /** the ISO timestamp of the write, the `updatedAt` of a changed entry (BR-09). */
  readonly now: string;
  /** the user's local calendar day, for `startedAt` and `finishedAt` (BR-02, BR-03, BR-04). */
  readonly today: CalendarDate;
}

const YEAR_WIDTH = 4;
const MONTH_DAY_WIDTH = 2;
// getMonth counts months from 0
const MONTH_OFFSET = 1;

const padded = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * the write context of a date: `now` is its ISO timestamp and `today` its local calendar day,
 * so a write late in the evening is dated the user's day, not the UTC one.
 * throws a RangeError on an invalid date, like Date#toISOString.
 */
export const libraryWriteContextAt = (date: Date): LibraryWriteContext => ({
  now: date.toISOString(),
  today: [
    padded(date.getFullYear(), YEAR_WIDTH),
    padded(date.getMonth() + MONTH_OFFSET, MONTH_DAY_WIDTH),
    padded(date.getDate(), MONTH_DAY_WIDTH),
  ].join('-'),
});

/**
 * the per-user snapshot of the media an entry tracks (ADR-0009), refreshed from the catalog.
 * `totalUnits` is the episode or chapter count, null when unknown (an ongoing title).
 */
export interface LibraryMediaSnapshot {
  readonly title: string;
  readonly imageUrl: string | null;
  readonly format: MediaFormat;
  readonly totalUnits: number | null;
  readonly isAdult: boolean;
}

/** one media in the user's library; the row id and the owner are repository concerns. */
export interface LibraryEntry {
  readonly key: MediaKey;
  readonly media: LibraryMediaSnapshot;
  readonly status: LibraryStatus;
  readonly progress: number;
  readonly score: number | null;
  readonly notes: string | null;
  readonly isFavorite: boolean;
  readonly startedAt: CalendarDate | null;
  readonly finishedAt: CalendarDate | null;
  /** the ISO timestamp of the creation. */
  readonly createdAt: string;
  /** the ISO timestamp of the last change (BR-09). */
  readonly updatedAt: string;
}

/** the user-editable fields of an entry a library mutation may change. */
export type LibraryEntryChanges = Partial<
  Pick<
    LibraryEntry,
    'status' | 'progress' | 'score' | 'notes' | 'isFavorite' | 'startedAt' | 'finishedAt'
  >
>;

const CHANGEABLE_FIELDS = [
  'status',
  'progress',
  'score',
  'notes',
  'isFavorite',
  'startedAt',
  'finishedAt',
] as const satisfies readonly (keyof LibraryEntryChanges)[];

/**
 * applies changes with the BR-09 convention of every library mutation: when a value differs, a
 * new entry with `updatedAt = ctx.now`; when every value is unchanged, the same reference, so
 * callers skip the write when `next === entry`. only the changeable fields are read, so a wider
 * object never overwrites the key, the snapshot or the timestamps. progress and status go through
 * setProgress and setStatus (library-progress.ts), which apply BR-01 to BR-04.
 */
export const updateLibraryEntry = (
  entry: LibraryEntry,
  changes: LibraryEntryChanges,
  ctx: LibraryWriteContext,
): LibraryEntry => {
  const next: LibraryEntry = {
    ...entry,
    status: changes.status ?? entry.status,
    progress: changes.progress ?? entry.progress,
    score: changes.score === undefined ? entry.score : changes.score,
    notes: changes.notes === undefined ? entry.notes : changes.notes,
    isFavorite: changes.isFavorite ?? entry.isFavorite,
    startedAt: changes.startedAt === undefined ? entry.startedAt : changes.startedAt,
    finishedAt: changes.finishedAt === undefined ? entry.finishedAt : changes.finishedAt,
  };
  if (CHANGEABLE_FIELDS.every((field) => next[field] === entry[field])) {
    return entry;
  }
  return { ...next, updatedAt: ctx.now };
};

/**
 * a new library entry (FR-10): status planned, progress 0, no score, notes or dates, not a
 * favorite, created and updated at `ctx.now`.
 */
export const createLibraryEntry = (
  key: MediaKey,
  media: LibraryMediaSnapshot,
  ctx: LibraryWriteContext,
): LibraryEntry => ({
  key,
  media,
  status: DEFAULT_LIBRARY_STATUS,
  progress: 0,
  score: null,
  notes: null,
  isFavorite: false,
  startedAt: null,
  finishedAt: null,
  createdAt: ctx.now,
  updatedAt: ctx.now,
});

/**
 * marks or unmarks an entry as a favorite (BR-09 convention); unfavoriting keeps the entry in
 * the library.
 */
export const setFavorite = (
  entry: LibraryEntry,
  isFavorite: boolean,
  ctx: LibraryWriteContext,
): LibraryEntry => updateLibraryEntry(entry, { isFavorite }, ctx);

/**
 * favorites a media (BR-05): not in the library (`entry` null), it is added as a planned
 * favorite; already in the library, only `isFavorite` changes, its status, progress and
 * snapshot are untouched (an existing favorite is a no-op, the same reference).
 */
export const favoriteMedia = (
  entry: LibraryEntry | null,
  key: MediaKey,
  media: LibraryMediaSnapshot,
  ctx: LibraryWriteContext,
): LibraryEntry =>
  entry === null
    ? { ...createLibraryEntry(key, media, ctx), isFavorite: true }
    : setFavorite(entry, true, ctx);
