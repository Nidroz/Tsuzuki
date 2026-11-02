# ADR-0017: Offline write queue and replay of the account library

- Status: Proposed
- Date: 2026-11-02

## Context

A-05 implements the offline requirement of `SPEC.md` ("Library and previously viewed media readable offline; writes queued and synced on reconnect") for the library synced across devices (FR-23): a signed-in user reads and changes their library without a connection, and the changes are replayed once the device is back online. Constraints:

- The account store (A-03) writes through PostgREST: the timestamp trigger stamps the server's `now()` on every regular write, and `authenticated` has no privilege on `updated_at` (ADR-0016, pgTAP `030` and `060`). A change replayed later through the same path would carry the replay time, not the time of the change, and BR-08 ("the most recent `updated_at` wins") would fail across devices: an offline change made before a change on another device would win once replayed, as the guest merge did before B1 (ADR-0016, "Resolution of the open question").
- ADR-0016 ("Reuse by A-05") reserved `private.write_client_library_entry` as the one rule for a client write that carries the time of its change, behind a `security definer` wrapper with the merge's guards, never a column grant. It covers inserts and replacements only: a removal has no time to compete with (no tombstone).
- Library keys are never persisted in the TanStack cache (`ARCHITECTURE.md` §6), so an offline launch has no account library to show. The guest store (L-02) lives on the device and never needs the network.
- TanStack's `onlineManager` does not follow the device yet: offline catalog queries fail after the http client's retries instead of pausing, and a stale detail refetched offline goes to `error` and leaves the persisted cache (C-07 review).
- The account store's session guard reads any `getSession()` error as `signed-out`, a failed offline token refresh included (A-03 review), and supabase-js single-flights its token refresh without a timeout of its own.
- Open review items attached to A-05 in `docs/BACKLOG.md`: the `LibraryContextProvider` cleanup under StrictMode, the writer's pruning and its failed write followed by a pending change, the coalesced `+1` lost when the app is killed, the stale merge run, the automatic merge retry, the merge refused on every attempt, the catalog failure monitor (shared failures, network errors).
- The risks: losing a change (an app kill, a failure, a sign out), sending one user's writes to another account (a session switch), letting a regular write choose its own time, and a removal deleting a newer change made on another device.

Options considered:

- Queue: **(a) TanStack persisted paused mutations**: the mutation variables (notes included) would go into the single query cache document, which `src/core/query/persister.ts` deliberately keeps free of mutations; a paused mutation resumes only through `setMutationDefaults` functions registered before the restore, keeps no per-key order and no per-user separation. Rejected. **(b) A per-user write-ahead queue in the app storage, next to the guest store**: chosen.
- Time of a replayed write: **(a) the regular PostgREST write at the replay's server time**: breaks BR-08 across devices (above). Rejected. **(b) a column grant on `updated_at`**: every regular write could then set its own time; rejected for the reasons of ADR-0016 option (b). **(c) a `security definer` wrapper over `private.write_client_library_entry`**, as ADR-0016 planned: chosen.
- Queued removals: **(a) an unconditional delete at replay**: an offline removal replayed after a newer change on another device would delete that change. Rejected. **(b) tombstones** (a table or a `deleted_at` column of removed keys with their time): they grow without bound, need pruning, change every read of the library, and change BR-08's "each local entry is upserted" for the guest merge. Rejected. **(c) a removal carrying the time of its change, deleting the stored row only when it is strictly older**: chosen, with the residual below ("Database").
- Offline reads of the account library: **(a) persisting the library keys in the TanStack cache**: one document for every scope, whose numbers are per process (`ARCHITECTURE.md` §6), written on a throttle rather than on each write, and the optimistic entries of a failed write would be persisted as truth. Rejected. **(b) a per-user device copy of the last server state, owned by the offline account library**: chosen.
- Connectivity: `expo-network` or `@react-native-community/netinfo`. `expo-network` is chosen by the owner: Expo-maintained (`CONTRIBUTING.md` §7), already part of the SDK, and enough for an online flag (`isConnected`, `isInternetReachable`).

## Decision

### Rule (B1, extended to the replay)

A client-supplied modification time is honored only by the guest merge and by the replay of writes the server has not confirmed, both through `private.write_client_library_entry` (and, for removals, the new `private.remove_client_library_entry`), capped at the server's `now()`. Every regular online write goes through PostgREST and keeps the server time from the trigger; `authenticated` still has no privilege on `updated_at` (pgTAP `030` and `060` keep proving it).

- A save replayed: BR-08 as in the guest merge (ADR-0016 "Rule"): inserted when the account has no entry of its key, replacing the stored values only when its time is strictly later, otherwise the stored copy is kept.
- A removal replayed: the stored entry of its key is deleted only when its `updated_at` is strictly earlier than the time of the removal, capped at `now()`; an equal or newer stored entry is kept. The absence the removal asked for already holds when the account has no entry of the key.
- Scope: only the account library (signed in) is queued. The guest store writes locally and never needs the network.

### Domain (`src/core/domain/library-sync.ts`)

Types and constants: `LibraryQueuedWrite` (`{ type: 'save'; entry }`, the time of a save being `entry.updatedAt`, or `{ type: 'remove'; key; removedAt }`), `LIBRARY_REPLAY_BATCH_SIZE` (100, equal to the SQL `max_writes`), `LIBRARY_REPLAY_OUTCOMES` (`written`, `kept`) and `LibraryReplayOutcome`. The implementation adds the pure rules next to them, each with explicit tests:

- `queuedWriteTime(changeTime, knownUpdatedAt)`: the later of the change time and 1 ms after `knownUpdatedAt` (null: the change time), in the `Date#toISOString` form. A change computed from a known state of its key is never timed at or before that state, so a device clock behind the server never makes a change lose to the copy it replaced.
- `libraryQueuedWriteKey(write)`: the media key of a write.
- `replayRemovalOutcome(removedAt, storedUpdatedAt | null)`: `written` when nothing is stored or the stored time is strictly earlier, `kept` otherwise; with `guestMergeDecision` for saves, the reference rule the in-memory fake applies (production code does not call it; the database applies the rule at the write).
- `overlayQueuedWrites(entries, writes)`: the entries with each queued save replacing or adding its key and each queued removal dropping its key, in the `LibraryRepository` list order.

### Interfaces (`src/core/repositories/library-repository.ts`)

```ts
export interface LibraryCallOptions { readonly signal?: AbortSignal }

export interface AccountLibraryRepository extends LibraryRepository {
  mergeGuestEntries(entries: readonly LibraryEntry[], options?: LibraryCallOptions): Promise<void>;
}

export interface RemoteAccountLibraryRepository extends AccountLibraryRepository {
  replayWrites(writes: readonly LibraryQueuedWrite[]): Promise<readonly LibraryReplayOutcome[]>;
}

export interface LibraryReplayRun {
  readonly status: 'done' | 'offline' | 'failed' | 'signed-out' | 'aborted';
  readonly confirmed: number;
}

export interface OfflineAccountLibraryRepository extends AccountLibraryRepository {
  replayQueuedWrites(options?: LibraryCallOptions): Promise<LibraryReplayRun>;
  subscribeToQueuedWrites(listener: () => void): () => void;
}
```

The doc comments there hold the contracts. `createSupabaseLibraryRepository` returns a `RemoteAccountLibraryRepository`; the hooks and `SessionLibraryContextProvider` receive `OfflineAccountLibraryRepository` instances.

### Device copy and write queue (`src/core/repositories/local/`)

Two documents per user id in the app `StorageAdapter` (MMKV on mobile), wired only by the composition root:

- `account-library-copy.<userId>`: `{ "version": 1, "entries": [...] }`, the last server state seen, each entry passing `libraryEntrySchema`. Of two entries of one key, the most recent `updatedAt` is kept.
- `account-library-queue.<userId>`: `{ "version": 1, "nextSeq": n, "writes": [{ "seq": s, "write": ... }] }`, at most one write per key (the latest), each with a persisted `seq` that never decreases (`nextSeq` in the document; a document read as damaged restarts at the highest seq this factory issued plus one). A save's entry passes `libraryEntrySchema`, a removal's key the media key schema and `removedAt` the timestamp schema. Of two writes of one key, the higher seq is kept.
- The user id is checked as a UUID before any key is built (a `RangeError` without a value otherwise).
- Both are untrusted: parsed with Zod on every read; an invalid element is dropped, an invalid queue document reads as an empty queue and an invalid copy document (not JSON, not a version 1 envelope) as no copy, never as an empty copy (which would answer `null` offline for entries the account holds), reported through `LibraryStorageError` with the existing reasons (`invalid-json`, `invalid-envelope`, `invalid-entries`, `duplicate-keys`), source `library-storage` and a `document` tag (`account-copy`, `account-queue`), at most once per reason and document per factory, never thrown.
- Each operation reads, changes and writes synchronously inside the call, as the guest store does, so two instances of one user never interleave.
- Coalescing keeps the order per key: a save carries the whole entry and a removal the absence, so the latest write of a key holds every earlier change of it.
- A confirmation removes a write only if the queued write of its key still has the seq that was sent: a newer write of that key queued meanwhile stays.
- The copy document is created only by a successful `list()`, which is complete. A per-key update (a confirmed write, a successful `get`) changes an existing copy and never creates one: a copy holding a few keys would answer `null` offline for an entry the account holds, and an Add computed on it would replace that entry when replayed.

Factory: `createOfflineAccountLibraries({ storage, remoteFor, isOnline, reporter, now? })` returns `(userId) => OfflineAccountLibraryRepository`, a new instance per call (the session switch needs a new instance per sign in), over `remoteFor(userId)`, the supabase store (`RemoteAccountLibraryRepository`). The per-user coordination shared by every instance of one user lives in the factory, never in a module global: the keys with a direct attempt in flight, the replay run in flight (single flight), the queue listeners, and the writes refused in this process. Purging the documents at sign out is A-06's scope.

### Writes (`save`, `remove`): write-ahead

1. `save` validates with `libraryEntrySchema` first, `remove` its key with the media key schema: a `RangeError` without a value, nothing queued.
2. The time of the write is `queuedWriteTime(changeTime, knownUpdatedAt)`: the change time is a save's `entry.updatedAt` or a removal's `now()`; the known time is that of the key's queued write, else its copy entry's `updatedAt`. A saved entry carries that time as `updatedAt`.
3. The write replaces the key's queued write in the persisted queue before any request, so it survives the app being killed.
4. When the device is offline (`isOnline()` false), or a replay run is sending that key, it stays queued and the call resolves at once with the queued state: a save with the queued entry, whose `createdAt` is the copy entry's when known, else the earlier queued save's, else the entry's own (set at step 2, for the direct attempt too); queue listeners are notified.
5. Otherwise, a direct attempt with the regular request (`remote.save` or `remote.remove`, at the server time):
   - success: the queued write is removed if its seq is unchanged, the copy takes the stored entry (or drops the key), and the call resolves with the stored entry;
   - `network` (no answer, the timeout, a gateway status, and a session read error, see "Account store") or `signed-out`: the write stays queued for this user only, the key's direct attempt is released, then the queue listeners are notified (so a run they start may send it), and the call resolves with the queued state. The change is kept on the device and replayed later, never under another user;
   - `rejected`, `unknown`, `invalid-row`: the queued write is removed if its seq is unchanged (the server refused it, or wrote it for `invalid-row`) and the call rejects with that error. The user sees "could not be saved" and the entry refetches, as before A-05: a write the server refused directly is reported to the user, never dropped silently.

### Reads

- `get(key)`: a queued write of the key wins (its entry, or `null` for a removal: read your writes). Offline: the copy's entry, or `null` when the user has a copy document, else it rejects with `network`. Online: `remote.get`; a success updates an existing copy for that key (unless a write of the key was confirmed while the read was in flight); `network` falls back as offline; `signed-out` and other failures reject.
- `list()`: offline: the copy overlaid with the queue (`overlayQueuedWrites`); without a copy document it rejects with `network`. Online: `remote.list()`; a success replaces the copy (keeping the copy's value of the keys confirmed while the list was in flight) and returns it overlaid with the queue; `network` falls back to the copy; `signed-out` and other failures reject.
- Offline reading of the account library is served by this per-user device copy, never by the persisted TanStack cache: library keys stay unpersisted (`ARCHITECTURE.md` §6). The copy holds notes in unencrypted MMKV, as the guest store does (R-04 reviews the encryption at rest; A-06 purges at sign out).

### Replay run (`replayQueuedWrites({ signal? })`)

- Single flight per user: a call while a run is in flight joins it, unless that run was aborted; then a new run starts once it settled. Reconnect, foreground and queued-write triggers therefore never send a write twice. A run stops being in flight in the synchronous step where it finds no replayable write left, so a write queued after that step starts a new run.
- Offline: the run ends at once with `offline`.
- Otherwise it sends the replayable writes (queued, no direct attempt of their key in flight, not refused in this process) by ascending seq, in batches of `LIBRARY_REPLAY_BATCH_SIZE`, one `remote.replayWrites(batch)` call each. Each batch is taken from the queue as it stands when it is sent, so writes queued during the run are sent by it.
- Per write, `written` (the state the write asked for now holds) or `kept` (the stored copy was as recent or newer): the write leaves the queue if its seq is unchanged; for `written`, the copy takes its state (a save's entry, a removal's absence); for `kept` the copy is left and the driver's refetch refreshes it. A write leaves the queue only once the server confirmed it, or confirmed that the stored copy is newer.
- `network` and `unknown`: retried after each of `LIBRARY_REPLAY_RETRY_DELAYS_MS` (2 s, 10 s, 30 s: three retries per run, waits through `setTimeout`, cut by the signal), then the run ends `failed` and the queue is kept until the next trigger; offline before a retry, it ends `offline`.
- `signed-out`: the run ends at once with `signed-out`, the queue kept.
- `rejected` on a batch of several writes: the batch is sent again one write per call. A write rejected alone is refused: kept in the queue, not replayed again in this process (until the next launch, or until a newer change of its key replaces it). The remote store reports each `rejected` call (A-03), so a refused write is reported with its batch and its own call, then no more in this process.
- Any other error (a `RangeError`: a bug, since the queue holds valid writes only) ends the run `failed`, reported with the source `library-replay`, the queue kept.
- `signal` aborted: no further call, the waits cut, the run ends `aborted`.
- Idempotent: each call is one transaction and a write leaves the queue only once confirmed, so a run interrupted mid-way and run again reaches the same final state: a write already applied answers `kept`, or, its time ahead of the server, is written again with the same values at its later capped time.
- `confirmed` counts the writes the run removed from the queue, `written` and `kept` alike.

### Database (migration `*_replay_library_writes.sql`)

Applied migrations are never edited; the regenerated `database.types.ts` is committed with it.

- `private.remove_client_library_entry(entry jsonb) returns boolean`: `security invoker`, `search_path = ''`, execute revoked from `public`, `anon` and `authenticated`. The same checks as `private.write_client_library_entry`: `auth.uid()` else `42501`; `updated_at` a string of the RFC 3339 pattern, checked before any cast; finite; not before the year 1; the key complete (a null key column would match no row and answer as an absence); else `22023` with fixed messages. It deletes the row of `auth.uid()` and the key only `where stored.updated_at < least(time, now())`, and returns `true` when it deleted the row or when the caller has no row of the key (the absence asked for holds), `false` when a row as recent or newer is kept. Called under definer rights, which bypass RLS, it filters on `auth.uid()` itself.
- `public.replay_library_writes(expected_user_id uuid, writes jsonb) returns table (id_namespace, media_kind, external_id, user_id, outcome)`: `security definer`, owner `postgres`, `search_path = ''`, fully qualified names, execute revoked from `public`, `anon` and `authenticated`, then granted to `authenticated` only.
  - The user is `auth.uid()` only (`42501` without one). `expected_user_id` is a guard, never a source: `42501` when `auth.uid()` is distinct from it. This closes the A-03 residual window for the replay (a token switched between the client's session guard and the request): the writes of user A never land in user B's account.
  - The input is validated whole before any write, each failure `22023` with a fixed message holding no value: a JSON array of at most `max_writes` (100) elements; each an object; `op` a string, `save` or `remove`; a save holding exactly `op`, the 15 writable columns and `updated_at`; a removal holding exactly `op`, `id_namespace`, `media_kind`, `external_id` and `updated_at` (the time of the removal); `updated_at` a string of the RFC 3339 pattern, checked before any cast, then not before the year 1 in UTC (checked up front for the whole batch, besides the private rules' own check); no key twice (compared as the table types them). A pattern-valid but impossible time (`2026-13-01T00:00:00Z`, an offset `+25:00`) fails at the cast with `22008` or `22009`, an uncastable key with `22P02`, a save with a null key column with `23502` (a removal gets `22023`): those codes echo only the caller's own value to the caller, and the client schema rejects all of them first.
  - Then per element, in input order: a save through `private.write_client_library_entry(element - 'op')`, a removal through `private.remove_client_library_entry(element - 'op')`, the outcome `written` (true) or `kept` (false). One call is one transaction.
- No tombstone, no new table or column. A removal that already reached the server, followed by the replay of an older save from another device (or the guest merge of an older guest entry), inserts the entry again. Accepted: nothing is lost and the user can remove it again, while a tombstone table grows without bound, needs pruning and would change BR-08's "each local entry is upserted".
- Clock residuals: a device clock ahead is capped at the call's `now()`, as in ADR-0016 (a retry caps again at its later `now()`); a clock behind is mitigated by `queuedWriteTime` for the device's own changes, and otherwise only penalizes the user's own data.

### Account store (`src/core/repositories/supabase/`)

- `replayWrites(writes)` in a new `library-replay.ts`, built on `createLibraryRequests`: at most `LIBRARY_REPLAY_BATCH_SIZE` writes (more: `RangeError`); saves validated with `libraryEntrySchema`, removal keys and times validated, a key twice a `RangeError`, nothing sent; an empty list resolves `[]` without a request; one `client.rpc('replay_library_writes', { expected_user_id, writes })` behind the session guard and under the request timeout; the answer parsed with Zod (the key, `user_id`, the outcome); a row of another user, or the function refusing its caller (`42501`: no user, or `expected_user_id` mismatch), rejects with `signed-out`, not reported, so the run stops with the queue kept and no write taken for refused; an answer not holding each key exactly once rejects with `unknown`, reported; the outcomes returned in input order. `LibraryOperation` gains `replay`.
- `mergeGuestEntries(entries, { signal })`: the signal is checked before each batch; aborted, the merge rejects with `signed-out` and sends no further batch.
- Session guard: a `getSession()` error (an error result or a thrown error, such as a failed offline token refresh) is read as `network` (transient: the write stays queued, the read falls back to the copy), no longer as `signed-out`; no session or another user's session stays `signed-out`.
- The supabase client's `fetch` is bounded by `SUPABASE_FETCH_TIMEOUT_MS` (30 s), a `global.fetch` wrapper (`createBoundedFetch`) in `create-supabase-client.ts` that chains the caller's signal. The bound covers the wait for the response, raced against the abort so a fetch ignoring the signal is not awaited past it (`SupabaseRequestAbortedError`, named `AbortError`); reading the body is the caller's part. auth-js single-flights the token refresh (`refreshingDeferred`) with no timeout of its own, so a stalled refresh request kept every later session read waiting until a restart; the bound releases it. The library calls keep their own 15 s timeout (`LIBRARY_REQUEST_TIMEOUT_MS`).

### Connectivity

- `expo-network`, imported only by `src/platform/connectivity.ts`: `createConnectivitySubscription(reporter): ConnectivitySubscription`, online meaning `isConnected === true && isInternetReachable !== false`. Each subscription listens to the network state events and reads the initial state once; a read settling after an event is dropped (the event is newer), and a failed initial read is reported with the source `connectivity`, never thrown (the `onlineManager` keeps its last value, online by default).
- `src/core/query/online-manager.ts`: `ConnectivitySubscription = (listener: (online: boolean) => void) => () => void`, `followConnectivity(subscribe)` binds TanStack `onlineManager.setEventListener` to it, and `isDeviceOnline()` reads `onlineManager.isOnline()`. The composition root calls `followConnectivity(createConnectivitySubscription(reporter))` and injects `isDeviceOnline` into the offline account library factory and the catalog failure monitor.
- Library queries (both repositories) use `networkMode: 'always'`, set in the query client defaults for the library key root: the guest store never needs the network, and the account library serves its device copy itself, so neither pauses offline. They also set `refetchOnReconnect: true`, which TanStack turns off by default in that mode, so a library read from the device copy is read from the server again on reconnect.
- Catalog queries keep `networkMode: 'online'`: offline they pause instead of failing, so a viewed media detail keeps its `success` state and stays in the persisted cache after an offline refetch. A refetch failing while online (a timeout, a 5xx) still leaves the detail out of the next persister write, since errors are not serialized: accepted, the in-memory copy stays shown and the next launch online refetches.

### Hooks (`src/core/hooks/`)

- Replay driver: `LibraryReplayDriver` (`src/core/hooks/LibraryReplayDriver.tsx`), rendered by `SessionLibraryContextProvider` inside its `LibraryContextProvider`, for the account instance whose merge is done (a run that rejects is reported with the source `library-replay`), never before the merge and never for a retired instance: a run when it becomes live, on reconnect (`onlineManager`), on app foreground, and when the instance notifies a queued write. After a run with `confirmed > 0` (kept writes included), the live library scope is invalidated (`['library', scope]`). The run's `AbortController` is aborted when the instance stops being live. The queue is per user, so user B's instance never reads user A's queue.
- Foreground seam: `SessionLibraryContextProvider` and `LibraryContextProvider` take an optional `subscribeToForeground` prop of the core type `ForegroundSubscription = (listener: (foreground: boolean) => void) => () => void`; React Native's `AppState` stays in `src/platform/app-state.ts`, passed by the composition root. Going to the background flushes the live writer (`flushAll`: the coalesced `+1` writes, both libraries); for the account library each flushed write reaches the write-ahead queue before any request (`save` and `remove` queue synchronously when the writer calls them, which it does once the key's earlier calls settled). `LibraryContextProvider` subscribes to the foreground once for every value (it flushes the value current at that moment), not once per value.
- Guest merge: retried automatically on reconnect when `failed`; each run gets an `AbortSignal`, aborted when its account is no longer the committed one, passed to `mergeGuestEntries`. The abort is decided a microtask after the commit that retired the account (a layout effect cleanup), so a StrictMode cleanup of the committed account aborts nothing.
- `LibraryContextProvider` under StrictMode and `<Activity>`: the effect cleanup still flushes and reports `onRetired` synchronously, but the scope's queries are removed only when the value is no longer current (a ref set by the effect setup, cleared by the cleanup, checked in a microtask), so a repeated cleanup on a live value never removes the live scope. The `TODO(A-05)` goes.
- Library writer: when a write fails, a newer pending change of that key (which carries the failed change, being computed from its optimistic entry) is dropped: its waiters reject with the same error, its timer is cleared, and the entry refetches. `activeKeyCount()` exposes the number of key states for tests (0 once every call settled).

### Catalog failure monitor (`src/core/catalog/catalog-failure-monitor.ts`)

- A failure shared by a foreground call and the background prefetch it joined is counted once: the http client rejects every caller of one request in flight with the same error object, kept in a `WeakSet` of counted errors. A malformed payload is the exception: each adapter call parses the shared body and throws its own `CatalogResponseError`, so `malformed_response` is still counted once per caller. Accepted (`ARCHITECTURE.md` §3).
- `CatalogNetworkError` is counted as a new kind `network` (`CATALOG_FAILURE_KINDS`) only while `isOnline()`, an injected option, is true.

### Constants

| Name | Value | Home |
| --- | --- | --- |
| `LIBRARY_REPLAY_BATCH_SIZE` | 100, equal to the SQL `max_writes` | `src/core/domain/library-sync.ts` |
| `LIBRARY_REPLAY_RETRY_DELAYS_MS` | `[2_000, 10_000, 30_000]` | `src/core/repositories/local/` |
| `SUPABASE_FETCH_TIMEOUT_MS` | 30 000 | `src/core/repositories/supabase/create-supabase-client.ts` |
| storage keys | `account-library-copy.<userId>`, `account-library-queue.<userId>` | `src/core/repositories/local/` |

`LIBRARY_REPLAY_BATCH_SIZE` and `max_writes` name each other in a comment.

### Left to A-06

- The sign-out purge must deal with the per-user device copy and write queue.
- Writes still queued at sign out would be lost by a purge: replay them first, or keep them.
- A flushed `+1` refused as `signed-out` after sign out is now kept in that user's queue, no longer lost.

## Tests

- pgTAP `070-replay-library-writes` (the rule) and `071-replay-library-writes-input` (the input checks): both functions' security mode and empty `search_path`, the private one executable by its owner only; `anon` refused; no user `42501`; an `expected_user_id` mismatch `42501` with nothing written; another user's row never written or deleted; a future time capped on insert, on replace and on removal; the BR-08 rule in both directions and on equal timestamps, for saves and removals; validation `22023` (`071`, the removal helper's own checks included: a time form postgres would read, a null time, an incomplete key, no user): 101 writes, not an array, an element that is not an object, an unknown `op`, an extra key, a missing `updated_at`, a bad time form (`epoch`, `infinity`, a BC date), a key twice, with nothing of the batch written; the removal of a missing row answers `written`; the answer holds the key, the caller and the outcome per write, in input order.
- pgTAP `010-privileges`: `authenticated` executes exactly `public.merge_guest_library_entries(jsonb)` and `public.replay_library_writes(uuid, jsonb)`. `060-library-updated-at` and `030-library-entries` unchanged: a regular PostgREST write still cannot set `updated_at`.
- Jest, domain: `queuedWriteTime` (a change time later, earlier, equal to the known time, no known time), `replayRemovalOutcome`, `overlayQueuedWrites` (replace, add, drop, list order), with explicit BR-08 cases.
- Jest, a shared replay contract (`test/core/account-library-replay-contract.ts`) run against the supabase store over the PostgREST fake (its model of the function follows the SQL one) and against the in-memory fake: insert, replace, keep on older and equal, removal written, kept and of a missing key, a future time capped, input order, a replay of the same writes reaching the same values, invalid input and a key twice (`RangeError`, nothing sent), an empty list; plus the store's own cases: more than 100 writes, the `expected_user_id` sent, a row of another user (`signed-out`), an answer missing or doubling a key (`unknown`), the session guard (a session read error now `network`), the fetch timeout releasing a stalled token refresh.
- Jest, the device copy and queue: an app kill and restart (a new factory over the same storage) keeping queued writes; a damaged document of each kind; the user id checked; a cross-user switch (user B's instance never sees user A's queue or copy); the copy never created by a per-key update; read your writes online and offline; a direct attempt per outcome (`network` and a session read error kept, `signed-out` kept, `rejected` removed and rejected); single flight with three concurrent triggers; a write queued during a run sent by it; the backoff with fake timers; an interrupted run run again reaching the same state; a refused write isolated (the rest of its batch confirmed, not sent again, replaced by a newer change); the abort.
- Jest, hooks: the replay driver (live instance only, after the merge, reconnect, foreground, a queued-write notification, invalidation, abort on switch); `LibraryContextProvider` under StrictMode keeping the live scope; the background flush; the writer dropping a pending change after a failure, and `activeKeyCount()` back to 0 once every call settled; the guest merge retried on reconnect and its stale run aborted before its next batch; the catalog monitor counting a shared failure once and network errors only online.
- Route test: user A signs out with queued writes and user B signs in: B never sends A's writes, A's queue stays intact, and A's next sign in replays them.
- The persisted media detail kept after a failed offline refetch (`persister.test.ts`).

## Precisions from the implementation (2026-11-02)

The sections above are aligned with what was built; the points that differ from the first draft:

- Connectivity: the platform module exports `createConnectivitySubscription(reporter)`, and a failed initial read is reported (source `connectivity`).
- Replay call: a `42501` from `replay_library_writes` reads as `signed-out` (the run stops, the queue is kept, nothing reported).
- Device copy: an invalid copy document reads as no copy, not as an empty copy.
- Writes: a queued save keeps `createdAt` from the copy, then from the earlier queued save; `remove` validates its key (`RangeError`); a direct attempt frees its key before notifying the queue listeners.
- Database: `private.remove_client_library_entry` refuses an incomplete key (`22023`), and `public.replay_library_writes` checks the year-1 bound for the whole batch up front.
- Supabase client: the fetch timeout covers the wait for the response, not the body.
- Catalog monitor: `malformed_response` is still counted once per caller (accepted).
- Hooks: the replay driver is its own component, `LibraryReplayDriver`; the guest merge abort under StrictMode is decided a microtask after the commit; `LibraryContextProvider` subscribes to the foreground once.

## Consequences

- Maintainability: a new local store (device copy and queue, two documents per user), a new account store call (`library-replay.ts`), one migration with one exposed and one private function, a connectivity module in `src/platform/` and its core binding, and the driver in `SessionLibraryContextProvider`. The replay rule lives in SQL, in the domain (the reference for the in-memory fake) and in the PostgREST fake: the shared contract and pgTAP fail on a drift, as for the merge. `LIBRARY_REPLAY_BATCH_SIZE` and `max_writes` must stay equal. `ARCHITECTURE.md` §2 to §6, §8, §9 and §12 describe the offline account library, the replay function, the catalog monitor change, `networkMode`, the connectivity and the session guard change. New dependency: `expo-network`.
- Data: a change of a signed-in user is on the device before any request and leaves the queue only once the server confirmed it or confirmed a newer copy; an app kill, a failure, the timeout or a sign out keeps it. A write the server refuses directly is reported to the user (the entry refetches); a write refused during a replay stays queued and is retried at the next launch. Last write wins by the time of the change: a newer change on another device wins silently, and an offline change of an entry another device added after the last list (the copy shows it absent) replaces that entry when replayed, if it is the more recent. A removal does not survive a later replay of an older save from another device (no tombstone). A replay that replaces the progress logs one `progress_events` row, dated at the replay, like the merge.
- Security: the exposed function is `security definer` because it writes `updated_at`; its scoping is its own: `auth.uid()` only, `expected_user_id` as a guard that refuses a switched token, the input bounded and validated before any write, fixed error messages, `search_path = ''`, execute granted to `authenticated` only, pinned by pgTAP `010` and `070`. Regular writes keep the server time. The client sends its own user id only as the guard, never as a source. The device copy and queue hold notes in unencrypted MMKV, like the guest store (R-04); they are per user id, so another user signed in on the device never reads or sends them, and A-06 purges them. Nothing is logged; reports hold reasons and operations only. The replay depends on the session and the queue only, never on a link parameter.
- Performance: each write rewrites the queue document and each confirmed write the copy document, synchronously, as the guest store does (R-02 measures large libraries). A replay is one call per 100 writes. Offline, reads come from the device without waiting for a timeout.
- Product: no new UI text: a queued write simply succeeds, offline reads show the last state seen. Offline with no copy yet (a first sign in offline), the library shows its error state.
- Future web app: the queue, the copy, the replay run, the rules and the hooks are in `src/core/` over `StorageAdapter` (`localStorage` on the web, synchronous) and the connectivity seam; only `expo-network` and `AppState` are mobile, behind `src/platform/`. The database function serves any client of the API.
