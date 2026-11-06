// the offline account library (docs/ARCHITECTURE.md §4): the account library of one signed-in
// user behind a device copy and a write queue, replayed to the server (A-05, ADR-0017), and the
// purge of its device data at sign out and account deletion (A-06, ADR-0018). types only
import type { AccountLibraryRepository, LibraryCallOptions } from './library-repository';

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
 * `mergeGuestEntries` goes to the account store directly, never through the queue. the sign out
 * and the account deletion delete the copy and the queue with `purgeDeviceData` (ADR-0018).
 */
export interface OfflineAccountLibraryRepository extends AccountLibraryRepository {
  /**
   * sends the queued writes this process may replay (none with a direct attempt of its key in
   * flight, none refused unless `retryStuckWrites` released it) by ascending queue order, in
   * batches of LIBRARY_REPLAY_BATCH_SIZE, each taken from the queue as it stands when it is sent,
   * until none is left. each confirmed write leaves the queue unless a newer write of its key
   * replaced it meanwhile; the device copy takes the state of each `written` one, and, after the
   * batch, the key of each `kept` one is read again with the account store's `get` (unless the
   * run was aborted or the purge closed it), an existing copy taking the answer; a failed read
   * leaves the copy entry and the status as they were. one run per user at a time: a call while a
   * run is in flight joins it (its result), unless that run was aborted, then a new run starts
   * once it settled. `network` and `unknown` failures are retried after each of
   * LIBRARY_REPLAY_RETRY_DELAYS_MS, then the run ends `failed`, and when its last failure was
   * `unknown`, each write of the batch that failed, still queued under the same seq, counts one
   * more failed run. a batch the database refuses is sent again one write per call, and a write
   * refused alone stays queued, marked refused (persisted): no run sends it again, at this launch
   * or a later one, until `retryStuckWrites` or a newer write of its key. `options.signal`
   * aborted: no further request, the wait for a retry cut, the run ends `aborted`. never rejects
   * for a failure of the server or the network: the status tells it.
   */
  replayQueuedWrites(options?: LibraryCallOptions): Promise<LibraryReplayRun>;

  /**
   * calls `listener` each time a write call leaves its write in the queue (offline, a replay run
   * sending its key, or a direct attempt failing otherwise than `rejected` or `invalid-row`), for
   * every instance of this user. returns the unsubscribe function.
   */
  subscribeToQueuedWrites(listener: () => void): () => void;

  /**
   * the number of writes in this user's queue now (FR-25, ADR-0018): every write the server has
   * not confirmed, whatever its state (waiting, sent by a replay run or a direct attempt, stuck),
   * since `purgeDeviceData` would delete each of them. the sign out asks before
   * purging when it is above 0. no request: read from the device synchronously, like every
   * operation of the store over the synchronous app storage, so it counts a write queued by a call
   * made just before. a queue document that does not parse counts 0 (reported by the store, as on
   * every read). 0 on an instance closed by `purgeDeviceData`.
   */
  queuedWriteCount(): number;

  /**
   * the number of stuck writes in this user's queue now (ADR-0017 "Stuck writes"): refused by the
   * database alone, or counted in LIBRARY_WRITE_FAILURE_LIMIT failed runs or more
   * (isLibraryWriteStuck). a stuck write stays queued, shown over the server state and counted by
   * `queuedWriteCount()`; one stuck on failed runs is still sent by every run. a newer write of
   * its key replaces it, neither refused nor counted. synchronous, read from the device; 0 on an
   * instance closed by `purgeDeviceData`.
   */
  stuckWriteCount(): number;

  /**
   * calls `listener` each time the stuck writes of this user may have changed, for every instance
   * of this user: a run ended, a write marked refused, a retry, a discard that removed writes, a
   * write replacing a stuck one. dropped once `purgeDeviceData` closed the instances. returns the
   * unsubscribe function.
   */
  subscribeToSyncState(listener: () => void): () => void;

  /**
   * the user's Try again: releases, in this process, the writes refused now, then joins or starts
   * a run (as `replayQueuedWrites`), which sends them with the rest of the queue; a run in flight
   * sends them with its next batch. a released write the database refuses again stays refused,
   * one confirmed leaves the queue; a write stuck on failed runs is sent like any other. resolves
   * `{ status: 'signed-out', confirmed: 0 }` once closed by `purgeDeviceData`.
   */
  retryStuckWrites(options?: LibraryCallOptions): Promise<LibraryReplayRun>;

  /**
   * the user's Discard, once confirmed: removes the writes stuck now from the queue (a stuck write
   * a newer change replaced is no longer stuck, and stays) and returns how many it removed. sends
   * nothing and leaves the device copy as it is: the caller refetches the server state. 0 once
   * closed by `purgeDeviceData`. a storage failure throws.
   */
  discardStuckWrites(): number;

  /**
   * deletes this user's library data from the device (FR-24, FR-25, ADR-0018): the device copy and
   * the write queue (`account-library-copy.<userId>`, `account-library-queue.<userId>`), with every
   * queued write the server has not confirmed: the caller has synced or asked first (sign out), or
   * the account is gone (account deletion). sends nothing: the account library on the server and
   * the documents of other users are untouched.
   *
   * it first closes the coordination every instance of this user shares (the replay run, the keys
   * in flight, the released refused writes, the queue and sync state listeners), then deletes both
   * documents. from then on
   * no instance of this user created before the call, this one included, reads or writes either
   * document again or sends a request: `list`, `get`, `save`, `remove` and `mergeGuestEntries`
   * reject with a LibraryRemoteError `signed-out` (a late flush of a retired writer is refused,
   * never queued); `replayQueuedWrites` and `retryStuckWrites` resolve `{ status: 'signed-out',
   * confirmed: 0 }`; `queuedWriteCount()`, `stuckWriteCount()` and `discardStuckWrites()` are 0;
   * the listeners are dropped and never called again. a call in flight
   * ends without touching the documents: a request already sent completes on the server (it cannot
   * be cut) but its outcome is not stored, and a replay run sends no further batch and ends
   * `signed-out`. an instance the factory creates afterwards for the same user id (the next sign
   * in) gets a new coordination and starts afresh: an empty queue and no copy (offline reads
   * reject with `network` until a `list()` succeeds). on an instance already closed it does
   * nothing, so it never deletes the documents of a later instance of the same user.
   *
   * synchronous, like every operation of the store over the synchronous app storage: the closing
   * and the deletion happen in one step, so no write of another instance can land between them,
   * and the documents are gone when it returns. a storage failure throws once both deletions were
   * tried, the coordination staying closed; the caller reports it and goes on with the purge.
   */
  purgeDeviceData(): void;
}
