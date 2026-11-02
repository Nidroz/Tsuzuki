// the library repositories (docs/ARCHITECTURE.md §4): the user's library entries, on the device
// for a guest (local/, L-02) and in supabase for a signed-in user (supabase/, A-03), the merge of
// the first into the second at sign in (A-04, ADR-0016), and the account library's offline writes,
// queued on the device and replayed (A-05, ADR-0017). types only
import type { LibraryEntry } from '../domain/library-entry';
import type { LibraryQueuedWrite, LibraryReplayOutcome } from '../domain/library-sync';
import type { MediaKey } from '../domain/media';

/** the options of a long account library call. */
export interface LibraryCallOptions {
  /**
   * stops the call between its requests once aborted: a request already sent is never cut (each is
   * one transaction), and none is sent after the abort.
   */
  readonly signal?: AbortSignal;
}

/**
 * the library of the current user (FR-10 to FR-15, FR-20, FR-23). hooks depend on this interface
 * only; SessionLibraryContextProvider picks the implementation from the session state (the guest
 * store signed out, the account store of the signed-in user, A-03, once the guest entries are
 * merged into it, A-04), and hooks do not know which one they use. an instance holds one owner's
 * library for its whole life: the account store is created for one user id, and rejects every
 * call once the session is no longer that user's.
 *
 * entries are domain entries, built by the rules of src/core/domain/library-entry.ts and
 * library-progress.ts. there is no filter or partial input: filtering, grouping, sorting and the
 * adult filter (BR-06) are done by the hooks with `select` over `list()` (L-04, L-05), and callers
 * pass whole entries. every entry an implementation returns has passed libraryEntrySchema
 * (src/core/schemas/library-entry.ts): within the database limits, its timestamps in the
 * `Date#toISOString` form, so two `updatedAt` compare as plain strings (BR-08).
 *
 * the interface does not order concurrent calls: callers serialize the writes of one key (L-03).
 * a storage or network failure rejects the promise, never swallowed (the account store with a
 * LibraryRemoteError, src/core/errors/library-errors.ts). entries hold personal data (notes,
 * titles): implementations never log them and never put them, or a key, in an error message or a
 * report tag.
 */
export interface LibraryRepository {
  /**
   * every entry of the user, most recently updated first (`updatedAt` descending). entries with
   * the same `updatedAt` follow their key in ascending order: namespace and kind in the order of
   * MEDIA_ID_NAMESPACES and MEDIA_KINDS (the postgres enum order), then externalId. the order is
   * defined on the returned values, so every implementation returns the same order. every entry
   * is returned, never a list cut at a page size (the account store may miss a row another device
   * moves or deletes during a read of more than one page, until the next refetch); an entry the
   * implementation cannot read is left out (the guest store drops it, the account store keeps the
   * row on the server and reports it).
   */
  list(): Promise<readonly LibraryEntry[]>;

  /**
   * the entry of a media, null when the media is not in the library. the account store rejects
   * for a row it cannot read (a row a newer app version wrote), so a caller never takes it for a
   * missing one and overwrites it; the guest store has already dropped such an entry (L-02).
   */
  get(key: MediaKey): Promise<LibraryEntry | null>;

  /**
   * inserts the entry of `entry.key`, or replaces the entry of that key, and resolves to the
   * stored entry, which callers keep instead of `entry`: the local implementation returns the
   * entry normalized by libraryEntrySchema, the supabase one the row with the server
   * `createdAt` / `updatedAt`. replacing keeps the stored `createdAt` in both, as the database
   * never lets a client write `created_at`.
   *
   * an entry libraryEntrySchema rejects (outside the database limits, BR-07 included) rejects with
   * a RangeError whose message holds no value, and nothing is written. callers skip the call when
   * the domain rule returned the same reference (BR-09).
   */
  save(entry: LibraryEntry): Promise<LibraryEntry>;

  /** removes the entry of a media; a no-op when the media is not in the library. */
  remove(key: MediaKey): Promise<void>;
}

/**
 * the guest library (FR-20), kept on the device only (local/library-repository.ts). its two bulk
 * removals are guest-only: `removeUnchanged` after a successful merge into the account (BR-08,
 * A-04: the merge reads `list()`, passes those entries to the account store's
 * `mergeGuestEntries`, and removes them only once it resolved), `clear` at the sign-out purge
 * (FR-25, A-06). an account library is removed by account deletion only (A-06).
 */
export interface GuestLibraryRepository extends LibraryRepository {
  /**
   * removes, in one synchronous read, change and write, each stored entry equal field by field to
   * one of `entries`: key, snapshot and every other field, `createdAt` and `updatedAt` included. a
   * stored entry changed or added since `entries` were listed stays, so the next merge sends it.
   * deletes the stored document when no entry remains, and writes nothing when no stored entry
   * matches. a storage failure rejects. called after a successful merge with the entries that
   * merge was given (BR-08: the guest store is cleared after a successful merge), never after a
   * failed one.
   */
  removeUnchanged(entries: readonly LibraryEntry[]): Promise<void>;

  /**
   * removes every guest entry; a no-op when there is none. the sign-out purge (FR-25, A-06), never
   * the merge, which removes with `removeUnchanged`.
   */
  clear(): Promise<void>;
}

/**
 * the account library of one signed-in user, in supabase (supabase/library-repository.ts, A-03,
 * FR-23), into which the guest library is merged (FR-22, BR-08, A-04, ADR-0016). no `clear`: an
 * account library is removed by account deletion only (A-06).
 */
export interface AccountLibraryRepository extends LibraryRepository {
  /**
   * merges guest entries into this account (BR-08, FR-22). each entry's time is its own
   * `updatedAt`, capped at the server's now of the call that writes it, so a device clock ahead of
   * the server never wins over a change made after that call (a retry is another call: see
   * below). per entry: inserted when the account has no entry of its key; replaces the account
   * entry (every field but the key and `createdAt`) only when that time is strictly later than
   * the account row's `updated_at`; otherwise, the account copy newer or equal, the account entry
   * is kept and nothing is written. the database compares at the write, so an account entry
   * changed meanwhile (another device) at a time not earlier than that capped time is never
   * overwritten, and with guest data on two devices the most recent change wins whatever the
   * order of the merges. a written entry keeps that time as `updatedAt`; an inserted one takes the
   * merge time as `createdAt`, a replaced one keeps its `createdAt`.
   *
   * entries are sent in batches, each written whole or not at all, and the merge resolves only
   * once every batch is confirmed: each entry written, or kept as not newer than the account copy.
   * rejects with a LibraryRemoteError on any failure (`network`, `signed-out`, `rejected`,
   * `unknown`; `invalid-row` is not used), after which the batches before the failed one may be
   * written. calling again with the same entries completes the merge: an entry written at its own
   * `updatedAt` now carries that time and is kept. an entry whose `updatedAt` was ahead of the
   * server was written at the first call's now, and the retry caps it again at its own, later
   * now: it is written again, with the same values and that later time, and so replaces an
   * account change made between the two calls (another device) at a time before that
   * `updatedAt`, that is less than the clock skew after the first call. the session guard (A-03)
   * applies before every request: with another user's session or none, it rejects with
   * `signed-out` and that request is not sent.
   *
   * an entry libraryEntrySchema rejects, or two entries of the same key, reject with a RangeError
   * whose message holds no value, and nothing is sent. an empty list resolves without a request.
   * entries hold personal data: never logged, never in an error or a report tag.
   *
   * `options.signal` (A-05): checked before each batch. once it is aborted, the merge rejects with
   * a LibraryRemoteError `signed-out` and sends no further batch; a batch already sent completes
   * on the server, and the batches before it may be written, as after any failure. the merge never
   * goes through the offline write queue: it needs the server, and a failure leaves the guest store
   * whole (ADR-0016).
   */
  mergeGuestEntries(entries: readonly LibraryEntry[], options?: LibraryCallOptions): Promise<void>;
}

/**
 * the account library in supabase as the offline account library uses it (supabase/, A-05,
 * ADR-0017): its regular calls write at the server time, and `replayWrites` sends the writes the
 * server has not confirmed with the time of their change.
 */
export interface RemoteAccountLibraryRepository extends AccountLibraryRepository {
  /**
   * replays queued writes of this user with their own times (ADR-0017), in one call that is one
   * transaction: every write is applied, or none. per write, in input order: a save is applied as
   * a guest merge entry (BR-08: inserted when the account has no entry of its key, replacing the
   * stored values only when its `updatedAt`, capped at the server's now of the call, is strictly
   * later than the stored `updated_at`); a removal deletes the stored entry of its key only when
   * that entry's `updated_at` is strictly earlier than `removedAt`, capped likewise. resolves with
   * one outcome per write, in input order: `written` when the state the write asked for now holds
   * (a removal of a key the account does not hold included), `kept` when the stored copy was as
   * recent or newer and nothing was written. a write already applied answers `kept`, or, its time
   * ahead of the server, is written again with the same values at the later capped time, so a
   * replay of the same writes reaches the same values.
   *
   * at most LIBRARY_REPLAY_BATCH_SIZE writes; more, a save libraryEntrySchema rejects, a removal
   * whose key or time is invalid, or two writes of one key reject with a RangeError whose message
   * holds no value, and nothing is sent. an empty list resolves to an empty list without a
   * request. the session guard applies (A-03), and the database refuses the call when the token's
   * user is not this store's user, so the writes of one user never reach another account.
   * rejects with a LibraryRemoteError on any failure: `network` (no answer, the timeout, a gateway
   * status, a 408 or a 429, a session read error), `signed-out` (another user's session or none, a refused token,
   * or a row of another user in the answer), `rejected` (the database refused the call: nothing
   * was written), `unknown` (an answer that does not parse or does not hold each key exactly once,
   * reported); `invalid-row` is not used. writes hold personal data: never logged, never in an
   * error or a report tag.
   */
  replayWrites(writes: readonly LibraryQueuedWrite[]): Promise<readonly LibraryReplayOutcome[]>;
}

/**
 * how a replay run of the offline account library ended (ADR-0017): every replayable write
 * confirmed (`done`), the device offline (`offline`, at the start or before a retry), the retries
 * spent on `network` or `unknown` failures (`failed`), the session no longer this user's
 * (`signed-out`), or the run's signal aborted (`aborted`). the queue keeps every write the run did
 * not confirm, whatever the status. `confirmed` counts the writes the run removed from the queue
 * (`written` and `kept` alike).
 */
export interface LibraryReplayRun {
  readonly status: 'done' | 'offline' | 'failed' | 'signed-out' | 'aborted';
  readonly confirmed: number;
}

/**
 * the account library of one signed-in user as the hooks use it (local/, A-05, ADR-0017): the
 * account store behind a device copy of the last server state seen and a write queue, both kept
 * per user id in the app storage, so the library reads and writes offline. a write is queued
 * before any request (it survives the app being killed), tried at once when the device is online,
 * and replayed with the time of its change until the server confirmed it. the copy and the queue
 * hold personal data in the app storage, never logged.
 *
 * `save` and `remove` resolve as soon as the change is kept on the device: with the stored entry
 * when the server confirmed it at once, else with the queued state (a save's entry at its queued
 * time, its `createdAt` kept from the copy when known). they reject with the LibraryRemoteError of
 * a direct attempt the server definitely refused (`rejected`) or wrote (`invalid-row`): the write
 * leaves the queue, so the user sees the failure and the entry refetches. any other failure
 * (`network`, `signed-out`, `unknown`: the server may have committed it) keeps the write queued
 * for this user only, until a replay confirms it. `get` and `list` show every queued
 * write over the server state (read your writes); offline, or when the server is unreachable,
 * they read the device copy, and reject with `network` when this user has no copy yet.
 * `mergeGuestEntries` goes to the account store directly, never through the queue.
 */
export interface OfflineAccountLibraryRepository extends AccountLibraryRepository {
  /**
   * sends the queued writes this process may replay (none with a direct attempt of its key in
   * flight, none the server refused in this process) by ascending queue order, in batches of
   * LIBRARY_REPLAY_BATCH_SIZE, each taken from the queue as it stands when it is sent, until none
   * is left. each confirmed write leaves the queue unless a newer write of its key replaced it
   * meanwhile, and the device copy takes the state of each `written` one. one run per user at a
   * time: a call while a run is in flight joins it (its result), unless that run was aborted,
   * then a new run starts once it settled. `network` and `unknown` failures are retried after
   * each of LIBRARY_REPLAY_RETRY_DELAYS_MS, then the run ends `failed`; a batch the database
   * refuses is sent again one write per call, and a write refused alone stays queued but is not
   * replayed again in this process. `options.signal` aborted: no further request, the wait for a
   * retry cut, the run ends `aborted`. never rejects for a failure of the server or the network:
   * the status tells it.
   */
  replayQueuedWrites(options?: LibraryCallOptions): Promise<LibraryReplayRun>;

  /**
   * calls `listener` each time a write call leaves its write in the queue (offline, a replay run
   * sending its key, or a direct attempt failing otherwise than `rejected` or `invalid-row`), for
   * every instance of this user. returns the unsubscribe function.
   */
  subscribeToQueuedWrites(listener: () => void): () => void;
}
