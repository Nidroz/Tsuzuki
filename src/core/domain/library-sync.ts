// the offline writes of the account library (A-05, ADR-0017): a write of a signed-in user kept on
// the device until the server confirmed it, and what the server answers when such a write is
// replayed with the time of its change. types, constants and the pure rules of ADR-0017: the time
// of a queued write, the key of a write, the replayed removal rule (the reference of the in-memory
// fake), the device copy overlaid with the queue, and a stuck write. entries are personal data:
// never logged
import type { LibraryEntry } from './library-entry';
import { compareLibraryEntries, libraryEntryId } from './library-view';
import type { MediaKey } from './media';

/**
 * a write of the account library that the server has not confirmed yet: the whole entry to store
 * (`save`, timed by its `updatedAt`), or the absence of a media's entry (`remove`, timed by
 * `removedAt`). every time is in the `Date#toISOString` form libraryEntrySchema normalizes to. the
 * queue holds at most one write per key, the latest: a save carries every field and a removal the
 * absence, so a later write of a key replaces the earlier one without losing a change.
 */
export type LibraryQueuedWrite =
  | { readonly type: 'save'; readonly entry: LibraryEntry }
  | { readonly type: 'remove'; readonly key: MediaKey; readonly removedAt: string };

/**
 * the most writes of one replay call: the `max_writes` of `public.replay_library_writes`
 * (supabase/migrations/*_replay_library_writes.sql), which must stay equal to it. the device queue
 * sends batches of this size, and the account store refuses a longer list.
 */
export const LIBRARY_REPLAY_BATCH_SIZE = 100;

/**
 * what the server did with one replayed write: the state the write asked for now holds
 * (`written`: the entry stored at its time, or the media absent), or the stored copy was as recent
 * or newer and was kept (`kept`: nothing written). either way the write is confirmed and leaves the
 * queue (BR-08: the most recent change wins, an equal time keeps the stored copy).
 */
export const LIBRARY_REPLAY_OUTCOMES = ['written', 'kept'] as const;

export type LibraryReplayOutcome = (typeof LIBRARY_REPLAY_OUTCOMES)[number];

/**
 * the failed replay runs after which a write stuck on `unknown` failures is shown as not synced
 * (ADR-0017 "Stuck writes"). it is still sent by every run: the count only makes it visible.
 */
export const LIBRARY_WRITE_FAILURE_LIMIT = 3;

/**
 * the failure state of a queued write: the database refused it alone (`refused`), and the replay
 * runs that ended `failed` on an `unknown` failure while sending it (`failures`). absent, false
 * and 0: a write queued or replaced since starts with neither.
 */
export interface LibraryWriteFailureState {
  readonly refused?: boolean;
  readonly failures?: number;
}

/**
 * whether a queued write is stuck (ADR-0017 "Stuck writes"): refused, or its failed runs at
 * LIBRARY_WRITE_FAILURE_LIMIT or above. a stuck write stays queued and shown until the server
 * confirms it or the user discards it.
 */
export const isLibraryWriteStuck = ({
  refused = false,
  failures = 0,
}: LibraryWriteFailureState): boolean => refused || failures >= LIBRARY_WRITE_FAILURE_LIMIT;

// one millisecond: a change computed from a known state is timed at least this much after it
const AFTER_KNOWN_STATE_MS = 1;

/**
 * the time of a queued write: the later of `changeTime` and one millisecond after
 * `knownUpdatedAt`, the time of the state of its key the change was computed from (null: none
 * known, the change time). a change made over a known state is never timed at or before it, so a
 * device clock behind the server never makes a change lose to the copy it replaced (BR-08). both
 * inputs and the result are in the `Date#toISOString` form, which compares as plain strings.
 */
export const queuedWriteTime = (changeTime: string, knownUpdatedAt: string | null): string => {
  if (knownUpdatedAt === null || changeTime > knownUpdatedAt) {
    return changeTime;
  }
  // the Date#toISOString form is the ecmascript date time string format, read alike everywhere
  return new Date(new Date(knownUpdatedAt).getTime() + AFTER_KNOWN_STATE_MS).toISOString();
};

/** the media key of a queued write. */
export const libraryQueuedWriteKey = (write: LibraryQueuedWrite): MediaKey =>
  write.type === 'save' ? write.entry.key : write.key;

/** the time of the change a queued write carries: a save's `updatedAt`, a removal's `removedAt`. */
export const libraryQueuedWriteTime = (write: LibraryQueuedWrite): string =>
  write.type === 'save' ? write.entry.updatedAt : write.removedAt;

/**
 * the BR-08 outcome of a replayed removal: `written` (the stored entry is deleted, or the account
 * holds none, so the absence asked for holds) when nothing is stored (`storedUpdatedAt` null) or
 * the stored entry is strictly older than `removedAt`, `kept` otherwise, equal times included. the
 * reference rule the database function applies at the write, with guestMergeDecision for saves;
 * both times in the `Date#toISOString` form.
 */
export const replayRemovalOutcome = (
  removedAt: string,
  storedUpdatedAt: string | null,
): LibraryReplayOutcome =>
  storedUpdatedAt === null || storedUpdatedAt < removedAt ? 'written' : 'kept';

/**
 * `entries` as they read once the queued `writes` are applied (read your writes): each save
 * replaces or adds the entry of its key, each removal drops its key, in the LibraryRepository list
 * order (`updatedAt` descending, then the key ascending). neither input is mutated.
 */
export const overlayQueuedWrites = (
  entries: readonly LibraryEntry[],
  writes: readonly LibraryQueuedWrite[],
): LibraryEntry[] => {
  const byKey = new Map(entries.map((entry) => [libraryEntryId(entry.key), entry]));
  for (const write of writes) {
    const id = libraryEntryId(libraryQueuedWriteKey(write));
    if (write.type === 'save') {
      byKey.set(id, write.entry);
    } else {
      byKey.delete(id);
    }
  }
  return [...byKey.values()].sort(compareLibraryEntries('updated'));
};
