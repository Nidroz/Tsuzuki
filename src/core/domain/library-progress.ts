// progress and status rules of a library entry, BR-01 to BR-04 (SPEC.md), with the BR-09 write
// convention of library-entry.ts: a change returns a new entry, a no-op the same reference
import { POSTGRES_INTEGER_MAX } from './database-limits';
import {
  updateLibraryEntry,
  type LibraryEntry,
  type LibraryEntryChanges,
  type LibraryStatus,
  type LibraryWriteContext,
} from './library-entry';

/**
 * the storage bound of library_entries.progress: BR-01's "no upper bound" for an unknown total
 * still has to fit the postgres integer column.
 */
export const PROGRESS_MAX = POSTGRES_INTEGER_MAX;

/**
 * the delay that coalesces rapid `+1` taps into one write (BR-09, docs/ARCHITECTURE.md §6
 * "Writes"); the timer lives in the library hook. each tap is applied optimistically with
 * incrementProgress, so the coalesced write is the last optimistic entry: applying
 * incrementProgress N times in sequence, BR-02 and BR-03 included, yields the state to write.
 */
export const PROGRESS_WRITE_COALESCE_MS = 500;

// the `+1` button step
const PROGRESS_STEP = 1;

/** the highest valid progress (BR-01): the total when known, else PROGRESS_MAX. */
export const progressMaxOf = (totalUnits: number | null): number => totalUnits ?? PROGRESS_MAX;

/**
 * whether a progress is valid (BR-01): an integer >= 0, at most the total when known, else at
 * most PROGRESS_MAX. NaN, infinities and fractions are invalid.
 */
export const isValidProgress = (value: number, totalUnits: number | null): boolean =>
  Number.isInteger(value) && value >= 0 && value <= progressMaxOf(totalUnits);

/**
 * whether the `+1` button applies: false at the total, and when the progress is above a total
 * that dropped on a snapshot refresh (docs/ARCHITECTURE.md §5).
 */
export const canIncrementProgress = (entry: LibraryEntry): boolean =>
  isValidProgress(entry.progress + PROGRESS_STEP, entry.media.totalUnits);

/**
 * sets the progress of an entry (FR-12). an unchanged value is a no-op (the same reference),
 * checked before validation, so saving an unchanged progress above a dropped total never throws.
 * a value invalid per BR-01 throws a RangeError (the UI validates first with isValidProgress).
 * then, on the new progress:
 * - BR-02: a planned entry becomes current, `startedAt = ctx.today` unless already set; any
 *   change counts, a decrease included.
 * - BR-03: reaching the known total sets status completed and `finishedAt = ctx.today`, from any
 *   status and after BR-02.
 * - otherwise the status is untouched: decreasing from the total keeps completed, the user
 *   reverts with setStatus.
 */
export const setProgress = (
  entry: LibraryEntry,
  value: number,
  ctx: LibraryWriteContext,
): LibraryEntry => {
  if (value === entry.progress) {
    return entry;
  }
  const total = entry.media.totalUnits;
  if (!isValidProgress(value, total)) {
    // the message holds no value: the UI shows its own translated error
    throw new RangeError('progress is outside the BR-01 range');
  }
  const started: LibraryEntryChanges =
    entry.status === 'planned'
      ? { status: 'current', startedAt: entry.startedAt ?? ctx.today }
      : {};
  const completed: LibraryEntryChanges =
    total !== null && value === total ? { status: 'completed', finishedAt: ctx.today } : {};
  return updateLibraryEntry(entry, { progress: value, ...started, ...completed }, ctx);
};

/**
 * the `+1` button: a no-op (the same reference, no throw) when canIncrementProgress is false,
 * else setProgress with progress + 1, BR-02 and BR-03 included.
 */
export const incrementProgress = (entry: LibraryEntry, ctx: LibraryWriteContext): LibraryEntry =>
  canIncrementProgress(entry) ? setProgress(entry, entry.progress + PROGRESS_STEP, ctx) : entry;

/**
 * sets the status of an entry explicitly; the same status is a no-op (the same reference).
 * - BR-04: completed sets progress to the total when known (lowering a progress above a dropped
 *   total) and `finishedAt = ctx.today`, total known or not.
 * - current sets `startedAt = ctx.today` unless already set (as BR-02).
 * - any other transition, reverting from completed (BR-03) included, keeps progress, startedAt
 *   and finishedAt: no history is erased.
 * an explicit status wins: setStatus never applies BR-02 or BR-03.
 */
export const setStatus = (
  entry: LibraryEntry,
  status: LibraryStatus,
  ctx: LibraryWriteContext,
): LibraryEntry => {
  if (status === entry.status) {
    return entry;
  }
  if (status === 'completed') {
    const total = entry.media.totalUnits;
    const progress: LibraryEntryChanges = total === null ? {} : { progress: total };
    return updateLibraryEntry(entry, { status, finishedAt: ctx.today, ...progress }, ctx);
  }
  if (status === 'current') {
    return updateLibraryEntry(entry, { status, startedAt: entry.startedAt ?? ctx.today }, ctx);
  }
  return updateLibraryEntry(entry, { status }, ctx);
};
