// the guest to account merge (BR-08, FR-22, ADR-0016): per guest entry, whether the account gets
// it, takes its values or keeps its own copy, and the equality that tells a guest entry unchanged
// since the merge listed it. pure: the reference rule, which the database function of the merge
// mirrors (supabase/migrations/*_guest_merge_client_time.sql) and the in-memory account store of
// the tests applies; the guest store removes the unchanged entries
import type { LibraryEntry } from './library-entry';
import { isSameMediaSnapshot } from './library-snapshot';
import { compareMediaKeys } from './media';

/**
 * what the merge does with one guest entry: `insert` it (the account has no entry of its key),
 * `replace` the account values with it (the guest copy is newer), or `keep` the account copy
 * (newer or as recent: nothing is written).
 */
export const GUEST_MERGE_DECISIONS = ['insert', 'replace', 'keep'] as const;

export type GuestMergeDecision = (typeof GUEST_MERGE_DECISIONS)[number];

/**
 * the BR-08 decision for one key: `insert` when the account has no entry of it
 * (`accountUpdatedAt` null), `replace` only when the guest `updatedAt` is strictly later than the
 * account's, `keep` otherwise, equal timestamps included (deterministic, no write, and a retry
 * stays a no-op). both timestamps are in the `Date#toISOString` form libraryEntrySchema
 * normalizes to (milliseconds, utc, a four-digit year), so they compare as plain strings.
 */
export const guestMergeDecision = (
  guestUpdatedAt: string,
  accountUpdatedAt: string | null,
): GuestMergeDecision => {
  if (accountUpdatedAt === null) {
    return 'insert';
  }
  return guestUpdatedAt > accountUpdatedAt ? 'replace' : 'keep';
};

/**
 * whether two entries are equal field by field: the key, the snapshot (isSameMediaSnapshot) and
 * every other field, `createdAt` and `updatedAt` included (strict equality). the guest store keeps
 * an entry that is not the same as the one the merge was given (ADR-0016).
 */
export const isSameLibraryEntry = (a: LibraryEntry, b: LibraryEntry): boolean =>
  compareMediaKeys(a.key, b.key) === 0 &&
  isSameMediaSnapshot(a.media, b.media) &&
  a.status === b.status &&
  a.progress === b.progress &&
  a.score === b.score &&
  a.notes === b.notes &&
  a.isFavorite === b.isFavorite &&
  a.startedAt === b.startedAt &&
  a.finishedAt === b.finishedAt &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt;
