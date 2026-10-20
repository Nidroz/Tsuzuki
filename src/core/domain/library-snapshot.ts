// the media snapshot of a library entry (ADR-0009) against the catalog's current data: the
// BR-09 write that refreshes it and the display-only view of an entry with a fresher snapshot
import type { LibraryEntry, LibraryMediaSnapshot, LibraryWriteContext } from './library-entry';

/** whether two snapshots hold the same five fields (strict equality, field by field). */
export const isSameMediaSnapshot = (a: LibraryMediaSnapshot, b: LibraryMediaSnapshot): boolean =>
  a.title === b.title &&
  a.imageUrl === b.imageUrl &&
  a.format === b.format &&
  a.totalUnits === b.totalUnits &&
  a.isAdult === b.isAdult;

/**
 * refreshes the snapshot of an entry from the catalog (ADR-0009), with the BR-09 convention: the
 * same reference when the snapshot is the same (isSameMediaSnapshot), else a new entry with the
 * new snapshot and `updatedAt = ctx.now`. status, progress and dates are never touched:
 * - a total that dropped below the progress keeps the progress (docs/ARCHITECTURE.md §5: no
 *   progress <= total check); canIncrementProgress then disables `+1`.
 * - a total that drops to the progress does not complete the entry: BR-03 applies to progress
 *   changes only, the user completes it with setStatus or the next progress change.
 */
export const refreshMediaSnapshot = (
  entry: LibraryEntry,
  media: LibraryMediaSnapshot,
  ctx: LibraryWriteContext,
): LibraryEntry =>
  isSameMediaSnapshot(entry.media, media) ? entry : { ...entry, media, updatedAt: ctx.now };

/**
 * the entry as shown with a fresher snapshot (the detail screen shows the provider's current
 * total and enables `+1` with it): the same reference when the snapshot is the same, else the
 * entry with the new snapshot and `updatedAt` unchanged. not a write: writes go through
 * refreshMediaSnapshot.
 */
export const withMediaSnapshot = (
  entry: LibraryEntry,
  media: LibraryMediaSnapshot,
): LibraryEntry => (isSameMediaSnapshot(entry.media, media) ? entry : { ...entry, media });
