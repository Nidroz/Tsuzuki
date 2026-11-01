# ADR-0016: Guest to account library merge

- Status: Proposed
- Date: 2026-10-31

## Context

A-04 implements FR-22 ("on first sign-in, guest data is merged into the account") under BR-08: each local entry is upserted, on conflict the most recent `updated_at` wins, and the local guest store is cleared after a successful merge. Constraints:

- Guest timestamps are client values: `updatedAt` is the device time of the entry's last change (BR-09), normalized by `timestampSchema` to the `Date#toISOString` form (L-02). Every stored guest entry has passed `libraryEntrySchema`, so it fits the database limits (ADR-0009, update).
- For a signed-in user the database sets `created_at` and `updated_at` itself: both default to `now()` on insert, the `before update` trigger stamps `now()`, and `authenticated` has no insert or update grant on either column (`ARCHITECTURE.md` §5). A merged row therefore takes the merge time, not the guest time.
- The account store (A-03) is created for one user id, filters its requests on that id on top of RLS, and checks before every call that the client's session is still that user's (the session guard), with an accepted residual window of one session storage read.
- `ARCHITECTURE.md` §4, §5 and §8 sketched a `security invoker` Postgres function followed by `guest.clear()`, "to be finalized in A-04".
- The main risks are losing the guest's only copy of an entry (a failed or interrupted merge, an entry changed while the merge runs) and writing guest entries into another user's account (a session change during the merge).

Options considered:

- **(a) A Postgres function called by RPC** (`security invoker` or `definer`): one atomic call, but a new function exposed to the API, with its grants and pgTAP guards, and keeping the guest time needs a bypass of the `updated_at` trigger. A new exposed function is a security-sensitive choice: not chosen without the owner's approval.
- **(b) An Edge Function with the service role**: it bypasses RLS, so the user scoping becomes the function's own code; more surface, and a privileged key on the path of every merge. Rejected.
- **(c) Plain client upserts after comparing with a read**: an account change from another device landing between the read and the upsert would be overwritten. Rejected.
- **(d) Conditional client writes under RLS**: inserts that never overwrite, and updates whose filter holds the comparison, so the database applies last-write-wins to the row as it is at the write. Chosen.

## Decision

### Rule

`src/core/domain/guest-merge.ts`, pure: `guestMergeDecision(guestUpdatedAt, accountUpdatedAt | null)` returns one of `GUEST_MERGE_DECISIONS`: `insert` (the account has no entry of the key), `replace` (the guest `updatedAt` is strictly later) or `keep` (the account copy is newer or equal). `isSameLibraryEntry(a, b)` is the field by field equality the guest store removes by: the key (`compareMediaKeys`), the snapshot (`isSameMediaSnapshot`) and every other field, `createdAt` and `updatedAt` included.

- Equal timestamps keep the account copy: deterministic, no write, and a retry stays a no-op.
- Both sides are compared in the `Date#toISOString` form (milliseconds, UTC), as strings. The server compares its microsecond `updated_at` with the guest millisecond value (`updated_at < guest`), which agrees with the client comparison of the truncated value: for a millisecond value `g`, `trunc(a) < g` exactly when `a < g`, since truncation keeps the order (verified on the local stack).

### Interfaces

`src/core/repositories/library-repository.ts` (the doc comments there hold the full contracts):

```ts
export interface GuestLibraryRepository extends LibraryRepository {
  removeUnchanged(entries: readonly LibraryEntry[]): Promise<void>;   // after a successful merge (BR-08)
  clear(): Promise<void>;                                             // the sign-out purge (FR-25, A-06)
}

export interface AccountLibraryRepository extends LibraryRepository {
  mergeGuestEntries(entries: readonly LibraryEntry[]): Promise<void>; // BR-08, FR-22
}
```

`createSupabaseLibraryRepository` returns an `AccountLibraryRepository`.

### Account side

`mergeGuestEntries(requests, entries)` lives in `src/core/repositories/supabase/library-merge.ts`, called by the account store. Both build on the request helpers they share in `library-requests.ts` (`createLibraryRequests`: the session guard, the request timeout `LIBRARY_REQUEST_TIMEOUT_MS`, the paged read, the error mapping and reporting) and on the row payloads of `library-row.ts`: `toLibraryRowPayload` for inserts, `toLibraryRowValues` (`LibraryRowValues`, without the key columns) for updates.

- Input: every entry is validated with `libraryEntrySchema`; an invalid entry, or two entries of one key, reject with a `RangeError` without any value, and nothing is sent. An empty list resolves without a request.
- Rounds, at most `GUEST_MERGE_MAX_ROUNDS` (3). Each round:
  1. reads the key and `updated_at` of every row of the user, paged like `list()` (`LIBRARY_PAGE_SIZE`, the offset advanced by the rows received, `count: 'exact'`), ordered by `id_namespace, media_kind, external_id`, with `.eq('user_id', userId)` on top of RLS, keeping the latest `updated_at` of a key read twice. Only those columns are read, so a row whose other values this version cannot read (a value a newer app version wrote) is classified on its time like any other, and a newer guest entry replaces its values (BR-08). A row whose key or `updated_at` does not parse is skipped: its entry is then sent as an insert, which never overwrites, so it stays unresolved;
  2. classifies each unresolved entry with `guestMergeDecision`;
  3. inserts the `insert` entries in batches of `GUEST_MERGE_INSERT_BATCH_SIZE` (100) with `ON CONFLICT DO NOTHING` (supabase-js `upsert(payloads, { onConflict: 'user_id,id_namespace,media_kind,external_id', ignoreDuplicates: true })`, `LIBRARY_CONFLICT_TARGET`), returning the key and `user_id` of the inserted rows;
  4. updates the `replace` entries one at a time, each with a conditional update filtered on `user_id`, its key and `updated_at` < the guest `updatedAt`, returning the row's key and `user_id`; the payload never holds the key columns.
- The rows a write returns are checked: a row of another user (the A-03 residual window: the token changed between the guard and the request) rejects with `signed-out`, not reported, and its entry is never confirmed; a body that is not rows of the asked columns, a returned row that does not parse included, rejects with `unknown`, reported.
- An entry is resolved when its write returned its row, or when the read shows the account copy newer or equal. The others (an insert that met a row, an update that matched none: a concurrent write from another device) go to the next round, which reads again. An entry still unresolved after the last round rejects the merge with `unknown` (the `LibraryFailure` `unresolved`), reported once.
- Every request, each page of the read included, goes through the session guard, under the request's single timeout timer: a session read that does not answer in time rejects with `network`, and nothing is sent. Failures map as in A-03 (`network`, `signed-out`, `rejected`, `unknown`; `invalid-row` is not used) and are reported as in A-03 (`rejected` and `unknown`), with the operation `merge`.

### Guest side

`removeUnchanged(entries)` replaces the `clear()` of the earlier sketch: one synchronous read, change and write that removes each stored entry equal field by field to one of `entries` (`isSameLibraryEntry`), timestamps included; it writes nothing when no stored entry matches, and deletes the stored key when no entry remains. An entry added or changed after the merge listed the store stays and is merged next time, so nothing this version can read leaves the device that the account did not receive or already held newer. The exception is the accepted L-02 rule: a stored entry this version cannot parse is dropped on every read, so the merge never sends it and the removal's write deletes it ("a damaged store loses what could not be read": it could not be merged either); the envelope-version rule (`ARCHITECTURE.md` §4 "Guest store") keeps a newer version from writing, under the same key, entries an older reader rejects. `clear()` remains, for the sign-out purge.

### When it runs

Each time a signed-in session starts in the app process (a launch with a stored session, a sign in, a switch to another user), and when the user taps Try again after a failure; the run reads the guest store and calls the account only when it holds entries. A token refresh keeps the user id and starts nothing. This covers FR-22's first sign-in, a later sign-in after guest use, and a retry on the next launch after a failure or a killed app. Owner: `SessionLibraryContextProvider`, which runs `mergeGuestLibrary` (`src/core/hooks/guest-merge.ts`) once per account instance and once per retry, and exposes the merge status (`idle`, `checking`, `merging`, `failed`) and the retry through `useGuestMerge()`. A run whose account instance is no longer the committed one is stale: it changes no state and removes nothing. Runs never overlap: a run starts once the previous run of the provider settled, since a stale run of the same user (signed out and in again) still passes the session guard, and its later rounds could otherwise write back an entry deleted meanwhile.

### Pending writes flushed first

Switching away from the guest library retires its library writer, which flushes its pending coalesced writes (`+1`, BR-09). `LibraryContextProvider` reports each retired writer's flush to its `onRetired` prop (`RetiredLibrary { repository, flushed }`), and the merge waits for every flush reported so far, except the pending library's, which never settles, before it reads the guest store.

### What the user sees

- While the guest store is read: the library loading state (the pending library, from the first render of the account instance).
- While the entries are merged: the library and favorites tabs show a spinner and "Adding the titles saved on this device to your account…" instead of their content, the detail's library section a spinner labelled with that sentence, and the library is the pending library, so no library action can write while the merge runs (an Add computed on a stale view would otherwise overwrite a merged entry).
- After success: the account library.
- On failure: the library stays the pending library until a retry succeeds, so no library action can compute a write on an account library lacking a guest entry (an Add or a `+1` there would make the account copy newer, and the next merge would keep it and remove the guest copy, its progress and notes lost). The library and favorites tabs show an error state (`library.merge.failedTitle`, `library.merge.failed`) with Try again, and the detail's library section the failure with Try again, without Add or the favorite toggle. The guest store is kept, and the merge runs again on Try again, the next launch or the next sign in. Offline at launch with guest entries, this is what the library shows until a retry succeeds (an automatic retry on reconnect belongs to A-05).
- The texts are translated in English and French.

### Safety

- One account store instance per user id, with the session guard; reads and updates filtered on the user id; the `user_id` of every written row checked.
- The account library is given to the tree only once its merge succeeded: no library action reads or writes it before.
- A merge whose session ended (sign out, another user) never removes guest entries; the next session's merge handles them.
- Any failure, the app being killed included, leaves the guest store intact.
- Failures that are not a `LibraryRemoteError` (a guest store failure, an input `RangeError`) are reported with `{ source: 'guest-merge' }`, stale runs included; the account store reports its own.

### Tests

- Jest: the rule (`insert`, `replace`, `keep` on equal and older, the millisecond forms), with explicit BR-08 tests; the shared merge contract `test/core/account-library-merge-contract.ts` (`describeAccountLibraryMergeContract`: an insert, an account entry left untouched, a replace, a keep on older and on equal, a mixed merge, a second merge changing nothing, an empty list, invalid entries and a key twice), run against the account store and against its in-memory fake (`createFakeAccountLibraryRepository`, `test/core/fake-library-repository.ts`); the merge against a fake PostgREST: an insert, a replace, a keep, a concurrent write resolved in a later round, an entry unresolved after the last round, a written row of another user, a returned write body that does not parse, the session ending mid-merge, a session read or an insert that does not answer in time, and a retry after a partial failure reaching the same final state; `removeUnchanged` keeping an entry changed or added after the listing, writing nothing when nothing matches, and deleting the document when nothing remains; the run (`mergeGuestLibrary`) and `SessionLibraryContextProvider` (the pending library while checking and merging, the flushes waited for, stale runs, the retry, the reporting); the library and favorites screens' and the detail library section's merging and failed states; no write reaching the account while a merge failed.
- Route tests through the root layout, with the real guest store over the app storage and the account library factory faked: `test/app/root-layout-guest-merge.test.tsx` (the merging state, then the merged account library with the guest store gone; a failure with the guest store kept, then Try again; a launch with a stored session) and `test/app/root-layout-guest-merge-session.test.tsx` (a sign out during the merge removes nothing, the entries go to the signed-in user's account only, an entry changed while the merge ran is kept for the next sign in, a `+1` in its coalescing window reaches the guest store before the merge reads it).
- pgTAP (`supabase/tests/database/050-guest-merge.test.sql`), as `authenticated`, pinning the database behaviour the merge relies on:
  1. `insert … on conflict (user_id, id_namespace, media_kind, external_id) do nothing returning id_namespace, media_kind, external_id, user_id` of a new key and a key the user already has: only the new row is returned, the existing row is unchanged, and no `progress_events` row is written.
  2. The conditional update (`user_id`, key, `updated_at < guest`) with a later guest timestamp updates one row, whose `updated_at` the trigger sets to `now()`, and logs one `progress_events` row when the progress changed; with an equal or earlier guest timestamp it matches no row and changes nothing.
  3. A row whose `updated_at` is `…:00.123456+00` is not matched by `updated_at < '…:00.123Z'` and is matched by `updated_at < '…:00.124Z'`.
  4. As user B, the same update with user A's key matches no row, and the insert creates B's own row (`user_id` B), A's row unchanged.
  5. As `anon`, the insert and the update are refused.

## Consequences

- Maintainability: no schema change, no new function, no migration: RLS and the existing grants only. The rule is one pure function; the merge shares the account store's request helpers (`library-requests.ts`: guard, timeout, paged read, error mapping; `LibraryOperation` gains `merge`, `LibraryFailure` gains `unresolved`) and row payloads (`toLibraryRowValues` added); the guest store gains one method. `ARCHITECTURE.md` §4, §5 and §8 replace the function sketch with this design, and no longer say that the guest library stays untouched while a user is signed in: merged entries leave it.
- Data: the merge is not atomic, but idempotent and safe to retry: a partial merge leaves some entries written and the guest store whole, and the next run keeps what was written. A replace that changes the progress logs one `progress_events` row (the `after update of progress` trigger), like any update; inserts log none. The schema v1 comment "logging an insert or a guest merge would invent history" assumed a merge that never logs; a replace records a progress change the user made on the device, dated at the merge.
- Device clock skew: a guest change is timed by the device clock and compared with server times, so a device clock ahead of the server by D lets a guest change win over an account change made less than D after it, and a clock behind makes it lose to an account change made before it. With a clock ahead, a retry may write an already merged entry again, with the same values (no progress event).
- Security: no new exposed surface; the client writes only its own rows, under RLS and the existing column grants. Every request is filtered on the user id and preceded by the session guard; a written row of another user (the residual window) is never confirmed, so the guest entries stay on the device, and RLS keeps that row inside the token's own library, as in A-03. Entries are never logged or put in an error or a report tag. The merge depends on the session and the guest store only, never on a route or link parameter, so opening a link adds no write of its own (`CONTRIBUTING.md` §7).
- Performance: one paged read of keys and timestamps, one insert per 100 new entries, one update per guest-newer entry (sequential), plus a round only under concurrent writes. A first sign-in with a few hundred guest entries and an empty account is one read and a few inserts. The library stays on the pending state while the merge runs, so the merge's duration is the user's wait: each request has the timeout, the session guard's read included, which `send` now runs under the request's timer for every account store call (one session read per request, each page of `list()` included).
- Product: A-06's sign-out purge must not delete the guest library while a merge is pending or has failed; the status is exposed by `useGuestMerge()`. The E2E flow of the merge against a backend is deferred to R-01, with the sign-in flow.
- Future web app: the rule, the account merge and the hook stay in `src/core/`, platform-agnostic. A web guest store implements `removeUnchanged` over its own storage with the same single read, change and write (`localStorage` is synchronous).

## Open question (owner)

Merged rows take the server's merge time as `updated_at`. With guest data on two devices (for example a phone and a tablet used without an account), the first device to sign in writes its entries at the merge time, so for a media in both stores the second device's entry loses even when its change is more recent: the newer progress is discarded.

The same stamping has a single-device form: a guest change made after a merge listed the store but before that entry's write landed loses at the next merge to the row stamped at the merge time. In the app this needs a sign out while a merge request is in flight and a change to that entry as a guest before it lands: the library is pending during a merge, and the retired guest writer is flushed before the store is read.

Faithful BR-08 across devices needs the guest `updatedAt` kept on merged rows, which needs a migration:

- **B1**: grant `insert` and `update` on `updated_at` to `authenticated`, and change the timestamp trigger to keep a client-written value (clamped to `now()`) and stamp `now()` only when a write leaves it unchanged, plus a `before insert` clamp; the merge then sends the guest `updatedAt`.
- **B2**: a `security invoker` RPC with a guarded trigger bypass.

Recommendation: B1 (smallest change, RLS unchanged; a user can only backdate their own rows, never into the future). Until decided, the limitation stands as documented.
