# ADR-0018: Sign out purge and account deletion

- Status: Accepted
- Date: 2026-11-03

## Context

A-06 implements FR-24 ("in-app account deletion, removing all user data"), FR-25 ("sign out purges local user data and caches") and the account deletion of the GDPR line of `SPEC.md`. The App Store requires in-app deletion from apps that create accounts (guideline 5.1.1(v)). Starting point:

- Sign out (A-01) revokes and removes the device session and deletes nothing (`ARCHITECTURE.md` §8). The device keeps, in unencrypted MMKV, the account library's device copy and write queue of each signed-in user id (`account-library-copy.<userId>`, `account-library-queue.<userId>`, notes included, ADR-0017), the guest library, the recent searches and the persisted query cache.
- Writes still queued at sign out would be lost by a purge, and a coalesced `+1` flushed after the session ended is kept in that user's queue (ADR-0017 "Left to A-06"). While the guest merge is `checking`, `merging` or `failed`, the guest store holds the only copy of entries the account has not confirmed (ADR-0016).
- Every foreign key to `auth.users` already cascades (schema v1): profiles, library entries, progress events (which also cascade from their library entry). No Storage bucket holds user files.
- Only the anon key ships in the app; the `service_role` key may live only in Edge Function secrets (`CONTRIBUTING.md` §7). `ARCHITECTURE.md` §8 planned a `delete-account` Edge Function.
- Risks: deleting another user's account (a user id chosen by the caller), leaking the service role key or a server text, a deletion triggered by a link or a web page, losing unsynced changes or unmerged guest entries, and a late write recreating purged documents.

Options considered:

- Server path: **(a) a `security definer` database function deleting the caller's `auth.users` row**: gives an API role a path into the `auth` schema, which the auth server owns, and bypasses its own deletion. Rejected. **(b) an Edge Function holding the service role key and calling the auth admin API**: chosen, as planned. **(c) a soft or delayed deletion**: a state, a job and a restore path the SPEC does not ask for, and data kept after the user asked for its deletion. Rejected: hard delete.
- Identity of the caller: **(a) the gateway's JWT check (`verify_jwt`) and the token's `sub` decoded**: a signature check only; the anon key is a valid project JWT with no user, and a token outlives its user until it expires. Rejected as the only check. **(b) `auth.getUser(jwt)`, the auth server checking the token and loading its user**: chosen, the gateway check kept as a first gate.
- Confirmation: **(a) re-authentication** (password, a provider round trip, an emailed code): one flow per sign-in method, Google and Apple not live (A-09), a new auth flow. **(b) a double confirmation on the device**: chosen by the owner, with the accepted risk below.
- Unsynced writes at sign out: **(a) ask**: chosen. **(b) keep the queue on the device until that user's next sign in**: leaves notes at rest on a device that may be handed over, which FR-25 forbids. **(c) drop them silently**: loss without notice. **(d) refuse to sign out until synced**: offline, no sign out at all. Rejected.
- Guest library at sign out: **(a) always cleared**: deletes the only copy of unmerged entries. **(b) ask**: the user cannot judge entries the pending library does not show. **(c) kept while the merge is `checking`, `merging` or `failed`, cleared once `idle`**: chosen.
- Query cache: **(a) the user-scoped queries only**: a list to keep in sync with every new key. **(b) every query**: chosen; catalog data refetches.

## Decision

### Account deletion, server (`supabase/functions/delete-account/`)

- `handler.ts`: platform-free TypeScript (web `Request` and `Response` only: no Deno global, no npm import, no Zod), typechecked, linted, formatted and tested with the app tooling. Exports `createDeleteAccountHandler(ports: DeleteAccountPorts | null): (request: Request) => Promise<Response>` (`null`: the env is missing) and `readDeleteAccountEnv(get: (name: string) => string | undefined)`, which returns the URL and the key, or `null` when either is missing or empty.
- `index.ts`: the Deno entry only. Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (provided by the platform) with `readDeleteAccountEnv`, creates the admin client from `npm:@supabase/supabase-js@2.117.3` (the exact app lockfile version) with `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`, implements the ports with `auth.getUser(token)` and `auth.admin.deleteUser(userId)`, and calls `Deno.serve`. Excluded from tsc and ESLint (Deno global, `npm:` specifiers), formatted by Prettier.
- `supabase/config.toml`: `[functions.delete-account]` with `verify_jwt = true`: the gateway rejects a request without a valid project JWT before the function runs.

```ts
type VerifiedUser =
  | { readonly status: 'verified'; readonly userId: string }
  | { readonly status: 'refused' } // an auth 4xx, or no user
  | { readonly status: 'gone' } // user_not_found: a valid token whose user no longer exists
  | { readonly status: 'unavailable' }; // the auth server unreachable, or a 5xx
interface DeleteAccountPorts {
  verifyUser(token: string): Promise<VerifiedUser>;
  deleteUser(userId: string): Promise<'deleted' | 'not-found' | 'failed'>;
}
```

A port that throws counts as `unavailable` (verify) or `failed` (delete). Checks in this order; every body is a fixed JSON from one constant table, sent with `Content-Type: application/json` and `Cache-Control: no-store`:

| Case | Status | Body |
| --- | --- | --- |
| any method but POST, OPTIONS included | 405, `Allow: POST` | `{"error":"method-not-allowed"}` |
| env missing | 500 | `{"error":"server-misconfigured"}` |
| `Authorization` not exactly `Bearer <token>`, or the token not three base64url segments of at most 8192 characters in all: no port called | 401 | `{"error":"unauthorized"}` |
| `verifyUser`: `refused` | 401 | `{"error":"unauthorized"}` |
| `verifyUser`: `gone` (the auth server answers `user_not_found`: the token's signature is valid, its user no longer exists) | 200 | `{"deleted":true}` |
| `verifyUser`: `unavailable` | 503 | `{"error":"unavailable"}` |
| the verified user id not a UUID | 500 | `{"error":"deletion-failed"}` |
| `deleteUser`: `deleted`, or `not-found` (already gone) | 200 | `{"deleted":true}` |
| `deleteUser`: `failed` | 500 | `{"error":"deletion-failed"}` |

Security model:

- The user id comes only from the user the auth server returned for the token: the body and the query are never read, so a request cannot name another user. The anon key or a token of another project is refused by the gateway or by `getUser`; a valid token whose user is already gone answers deleted without any call (`gone`), which only tells the token's holder what already holds.
- The service role key exists only in the function env: never in the app, the repository, a request or response body, a header or a log. The admin client keeps no session.
- Fixed bodies: no error text, id, token or key, so a supabase error message (which can hold an email) never leaves the function.
- No CORS headers at all: the caller is the mobile app, which CORS does not concern; a web page cannot call the function (its preflight gets no CORS answer), and the bearer token is never a cookie, so no cross-site request carries it. The future web app decides a restricted CORS in its own ADR.
- No logging (no `console`): the platform logs the status of each invocation, nothing personal.
- Hard delete (`deleteUser` without soft delete): the auth user, its identities and sessions go, and the cascades remove every row. "Not found" answers deleted: a repeated or concurrent call has the outcome asked for, so a retry is safe.

### Cascade guarantee (pgTAP `080-account-deletion`)

Deleting the auth user is the only server step; the foreign keys remove the rest. No migration is needed. `supabase/tests/database/080-account-deletion.test.sql`: before, both users hold a profile, entries and events; `delete from auth.users` (what the admin delete runs) removes user A's profile, library entries and progress events; user B's rows are untouched. Lasting guards: every foreign key of `public` and `private` has `confdeltype = 'c'`; profiles, library entries and progress events reference `auth.users`; every `user_id` column of a public table references `auth.users`. A future table holding user data without the cascade fails CI.

### Account deletion, client

- `AuthRepository.deleteAccount(): Promise<void>` (contract in `src/core/repositories/auth-repository.ts`), implemented by `requestAccountDeletion(client, reporter)` in `src/core/repositories/supabase/account-deletion.ts`: no session on the device, `session-expired` and nothing sent; else `client.functions.invoke(ACCOUNT_DELETION_FUNCTION, { method: 'POST', timeout: ACCOUNT_DELETION_TIMEOUT_MS })`, no body, no user id (supabase-js adds the session's access token); the answer parsed with Zod as `{ deleted: true }`. It neither purges nor signs out. `AuthOperation` gains `delete-account`.
- `AccountDeletionError` (`src/core/errors/account-deletion-errors.ts`; `ACCOUNT_DELETION_ERROR_REASONS`, `AccountDeletionErrorReason`, `isAccountDeletionError`): a fixed message per reason, no cause. `offline`: the hook found the device offline, nothing sent. `network`: nothing sent after a session read error, or no answer (`FunctionsFetchError`: a fetch error, the timeout) or a 408, 429, 502, 503 or 504; the outcome may be unknown. `session-expired`: no session on the device, or 401. `unknown`: anything else (another status, `FunctionsRelayError`, a 2xx that does not parse, a thrown error).
- Only `unknown` is reported, by the supabase implementation: the `AccountDeletionError`, never the supabase error, with `{ source: 'auth', tags: { operation: 'delete-account', status?, code? } }`: `status` the HTTP status when known, `code` the body's `error` when it parses as one of the fixed codes.
- `useDeleteAccount()` (`src/core/hooks/use-delete-account.ts`), a mutation with the auth mutation options (`networkMode: 'always'`, `gcTime: 0`): (1) the session's account instance (`useSessionLibrary().account`) is taken when the call starts; none: `session-expired`, nothing sent; (2) `isDeviceOnline()` false: `offline`, nothing sent; (3) `deleteAccount()`: a rejection rejects the mutation, nothing purged, still signed in; (4) the device purge, the queued writes included (discarded on purpose: the account is gone), the guest library by the rule below; (5) `signOut()` ends the session locally; a rejection is reported (`account-deletion`, tags `{ step: 'sign-out', reason }`) and the mutation still resolves. The purge comes before the local sign out, so the device data is gone even if the sign out fails or the app is killed in between.
- Confirmation (owner decision): the "Delete account" button of `AccountSection` (signed in) pushes `app/account/delete.tsx`, a thin route rendering `DeleteAccountScreen` (`src/features/settings/`). It explains what is deleted (the account and its sign-in methods; the library on every device: titles, progress, scores, notes, favorites; the progress history; on this device: the library copy, unsynced changes, recent searches, cached data) and that it cannot be undone. A destructive button opens a confirmation `Sheet` whose confirm is destructive (`danger`): two deliberate taps, no re-authentication, the same flow for email, Google and Apple accounts. Signed out or loading: a "sign in first" state, no action. The route reads no param: a link opens the screen at most. Pending: buttons disabled, a labelled spinner. Success: a "your account was deleted" state, then `router.dismissTo('/settings')`. Failure: the translated reason inline, still signed in.
- **Accepted risk**: anyone holding the unlocked device with the app signed in can delete the account, irreversibly. Mitigated only by the device lock, the session readable only while unlocked (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), the dedicated screen and the two taps. A stolen access token (valid up to an hour) can too, like any other account write.

### Sign out (FR-25)

`useSignOut()` moves to `src/core/hooks/use-sign-out.ts`: a mutation (auth mutation options) taking `SignOutOptions` and resolving a `SignOutResult`:

```ts
interface SignOutOptions { readonly discardUnsynced?: boolean }
type SignOutResult = { readonly status: 'signed-out' } | { readonly status: 'unsynced'; readonly count: number };
```

1. The session's account instance is taken when the call starts. None (not signed in): `signOut()` only, nothing purged.
2. Sync, bounded together by `SIGN_OUT_SYNC_TIMEOUT_MS`: `flushAll()` of the live library writer (the coalesced `+1` sent under the session it was made in), then `account.replayQueuedWrites({ signal })`, whatever the merge status (each write carries the time of its change, so BR-08 does not depend on the order with the merge). A joined run may sit in its 30 s backoff: at the budget the hook aborts its signal and stops waiting (a joined run is aborted by the driver once the instance retires). A rejection here is reported (`sign-out`) and does not stop the sign out.
3. `account.queuedWriteCount()` above 0 without `discardUnsynced`: resolve `{ status: 'unsynced', count }`, nothing else. `AccountSection` shows a confirmation Sheet ("sign out and lose N unsynced changes", plural in en and fr, confirm `danger`). Cancel: still signed in, nothing touched. Confirm: the same call with `discardUnsynced: true`: the sync is tried again, the count skipped, whatever remains purged.
4. The guest merge status is read now, before the session ends (it reads `idle` once signed out): `keepsGuestLibrary(status)` is true for `checking`, `merging` and `failed`. Those entries are guest data the account has not confirmed: they show again as the guest library after sign out, as before the sign in, and the next sign in merges them. Once `idle`, the merge concluded and the guest store holds nothing the account lacks (BR-08): it is cleared.
5. `signOut()`: a rejection (`network`, an expired token offline) rejects the mutation: nothing purged, still signed in.
6. The device purge, then `{ status: 'signed-out' }`. Sign out shows a loading label while it runs.

An involuntary session end (a refresh token expired or revoked) purges nothing, as before: the user's queue waits for their next sign in (ADR-0017).

### Device purge

`purgeDeviceUserData(input)` (`src/core/hooks/device-purge.ts`, with `keepsGuestLibrary`) is a plain async function, bound to the contexts by `useDevicePurge()` (`src/core/hooks/use-device-purge.ts`), which the two hooks call with `{ account, clearGuestLibrary }`. Each step is independent: a failure is reported as a `DevicePurgeError(step)` (`src/core/errors/device-purge-errors.ts`, steps `DEVICE_PURGE_STEPS`, fixed message, no cause; `{ source: 'device-purge', tags: { step } }`), the next steps still run, and the purge never rejects. In order:

1. `account-library`: `account.purgeDeviceData()`.
2. `guest-library`: `GuestLibraryRepository.clear()`, unless kept by the guest library rule (sign out, step 4).
3. `recent-searches`: `RecentSearchesRepository.clear()`.
4. `query-cache`: `queryClient.removeQueries()`: every query, the catalog's too; mutations untouched (the running sign-out mutation lives there), so never `queryClient.clear()`.
5. `persisted-cache`: `removePersistedCache()`, the persister's `removeClient` (cancels the throttled save, deletes `query-cache`). After step 4, so the document is gone when the purge returns and a later save holds only queries fetched after it.
6. The purge generation +1, last, so a screen remounted by it reads the purged state.

Wiring: `DevicePurgeContextProvider` (`src/core/hooks/DevicePurgeContextProvider.tsx`, context and `DevicePurgeValue` in `device-purge-context.ts`) takes `removePersistedCache: () => void | Promise<void>` and `reporter`, and holds the generation. The composition root hoists the persister (`const queryPersister = createQueryPersister(storage)`, given to `createPersistOptions`), passes `removePersistedCache={queryPersister.removeClient}`, and renders the provider inside `SessionLibraryContextProvider`. `usePurgeGeneration()` returns the generation: `app/(tabs)/search.tsx` keys `SearchScreen` with it, so the mounted text, kind, filters, page, results and recent searches list reset (the tab stays mounted). `SessionLibraryContextProvider` exposes the session's account instance (any merge phase; `null` signed out or loading) and the guest repository through `SessionLibraryContext` (`src/core/hooks/session-library-context.ts`, `SessionLibraryValue { account, guest }`, read with `useSessionLibrary()`): one memoized value and one wrapper element.

`OfflineAccountLibraryRepository` gains `queuedWriteCount(): number` and `purgeDeviceData(): void` (contracts in `library-repository.ts`). The purge closes the per-user coordination of the factory (dropped from its map), then deletes both documents. Every instance created before then never touches the documents again and sends nothing: its calls reject `signed-out` (a late flush of a retired writer is refused, never queued), a replay resolves `signed-out` with nothing sent, a run in flight sends no further batch, a request already sent completes on the server but its outcome is not stored. The next instance of that user starts afresh. Synchronous like the store, so no write lands between the closing and the deletion.

| Purged | How | Why |
| --- | --- | --- |
| the user's device copy and write queue | `purgeDeviceData()` | titles, progress, notes |
| the guest library, once the merge is `idle` | `GuestLibraryRepository.clear()` | personal data; kept while unmerged |
| recent searches, stored and mounted | `clear()`, the purge generation | personal data (C-04) |
| mounted search state | the purge generation | search text, filters, results |
| the query cache | `removeQueries()` | FR-25 "and caches" |
| the persisted cache document | `removeClient` | same |
| the session (secure store) | `signOut()` | tokens |

| Kept | Why |
| --- | --- |
| preferences (theme, language, adult content) | device settings, used in guest mode too |
| the expo-image cover cache | public CDN images keyed by URL, no user id or library data, not listed by the app; at most it shows which covers were displayed to someone reading the app sandbox |
| other users' per-user documents | their queued writes wait for their own next sign in |
| PKCE verifiers of unfinished flows, if supabase-js keeps any | random, no personal data, replaced by later flows; the implementation inventories the secure store keys |
| Sentry | no user context is ever set (no `setUser`): nothing to clear |

### Apple token revocation (5.1.1(v))

Guideline 5.1.1(v) asks an app offering Sign in with Apple to revoke the user's Apple tokens when the account is deleted. Not implemented: A-09 is not live, iOS builds are off, and the Apple provider is disabled in every project, so no Apple identity can exist. A-09 must add, before Apple sign-in ships: capture the Apple refresh token (the web flow's provider refresh token at sign in) or the authorization code (native flow) and send it to the server, which keeps it server side only (a table no API role can read, RLS and pgTAP, cascading with the user; never kept on the device); in `delete-account`, before `deleteUser`, revoke it with Apple's revoke endpoint and a client secret built from the Sign in with Apple key held in the function secrets; a failure policy (proposed: Apple answering the token already invalid counts as revoked; any other failure answers 503 `unavailable` without deleting, so the user retries); tests of each outcome. This ADR gets a dated Update then.

### Deploy

The owner deploys per project from the repository root: `pnpm exec supabase functions deploy delete-account --project-ref <ref>` (`config.toml` applies `verify_jwt = true`; never `--no-verify-jwt`). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` come from the platform: no secret to set. Post-deploy check per project: a POST without a token answers 401; then, on a build pointing at the project, a throwaway email account signed in deletes itself: the success state shows and the user is gone from Authentication → Users. A `session-expired` with a fresh session means the gateway's `verify_jwt` does not accept the project's JWTs (asymmetric signing keys); an `unknown` with `code` `server-misconfigured` or `deletion-failed` points at the keys (legacy keys disabled). The owner decides (for example `verify_jwt` off for this function, `getUser` staying the real check), recorded as an Update of this ADR.

### Residuals (accepted)

- A deletion whose answer is lost after the server committed it: the user sees `network` and stays signed in on the device. A retry with the same token answers deleted (the auth server reports the user gone, `user_not_found`), so the client purges and signs out as after a success. Without a retry before the next token refresh fails (the refresh token went with the user), the session ends involuntarily, without a purge, and the data stays until the app data is cleared (A-10).
- A failed local sign out right after a successful deletion: the data is already purged; the session stays until the next token refresh fails and ends it. Meanwhile the closed account library rejects its calls (`signed-out`) and the library shows its error.
- A deleted user's other devices end their session involuntarily and keep that user's device copy and queue until the app data is cleared (their own devices). Backlog item A-10 tracks a purge when the auth server reports the user gone, which would also cover a lost answer never retried.
- A change made on another screen after the count of step 3 and before the purge is purged with the queue.
- The app killed, or the `account-library` purge step failing, after `signOut()` removed the session and before the device purge ran: the device is signed out and that user's copy, queue and caches stay, and nothing retries the purge (A-10: a purge-pending marker written before `signOut()` and run at launch).
- From the A-05 review: a queue document with a newer envelope version (an update rolled back) reads as empty and the next queued write replaces it; accepted, as `ARCHITECTURE.md` §4 lets a newer version keep the key only if older readers can read it. A direct write that times out but commits at server time S stays queued at its time t1; with a device clock behind the server, a later change of that key timed before S answers `kept` and is lost without notice. This qualifies ADR-0017 "Clock residuals": it needs both a committed timeout and a lagging clock, and touches only the user's own data.

### Constants

| Name | Value | Home |
| --- | --- | --- |
| `ACCOUNT_DELETION_FUNCTION` | `'delete-account'` | `src/core/repositories/supabase/account-deletion.ts` |
| `ACCOUNT_DELETION_TIMEOUT_MS` | 20 000 (under `SUPABASE_FETCH_TIMEOUT_MS`) | same |
| `SIGN_OUT_SYNC_TIMEOUT_MS` | 10 000 | `src/core/hooks/use-sign-out.ts` |
| report sources | `device-purge`, `sign-out`, `account-deletion` | `device-purge.ts`, `use-sign-out.ts`, `use-delete-account.ts` |

## Tests

- Handler (`supabase/functions/delete-account/handler.test.ts`): each row of the table above; no port called on a bad method or header; the body and the query never read; the user id passed to `deleteUser` is the verified one; exact bodies and headers, no CORS header; a throwing port; `readDeleteAccountEnv` (missing, empty, present).
- pgTAP `080-account-deletion` (above).
- `account-deletion.ts` over a fake client: no session or a session read error (nothing sent); the invoke arguments (POST, no body, the timeout); 200 parsed; each status of the mapping; a fetch error, the timeout, a relay error; a 2xx that does not parse; reports for `unknown` only, with `status` and `code`, nothing personal. The error module: messages fixed per reason.
- Offline account library: `purgeDeviceData` deletes both documents; an instance created before (a late flush, a direct attempt, a read, a replay, a run in flight) never writes them again and sends nothing more; another user untouched; a later instance starts afresh; a second call on a closed instance keeps a later instance's documents; `queuedWriteCount` (waiting, in flight, refused; 0 once closed).
- Hooks: `useSignOut` (the order; the budget with fake timers; `unsynced` then cancel and confirm; the guest library kept for `checking`, `merging`, `failed` and cleared when `idle`; a `signOut` rejection purges nothing; no account instance); `useDeleteAccount` (offline and failures purge nothing; success purges the queue, then signs out; a failed sign out reported, still resolved); `purgeDeviceUserData` (each step failing alone, the rest still run, fixed reports; the generation last); the search route reset.
- Screens and routes (RNTL): `AccountSection` (loading label, the unsynced Sheet), `DeleteAccountScreen` (signed out, loading, explanation, two-step confirmation, pending, success, each error), the route test `test/app/delete-account.test.tsx` and the sign-out purge route tests in `test/app/`. ADR-0017's route test keeps its meaning for a session that ends without the sign-out hook.

## Precisions from the implementation (2026-11-03)

The decision above stands; the implementation made these points precise:

- Auth answers: `index.ts` maps them with two pure functions exported and tested by `handler.ts`. `toVerifiedUser` (the `getUser` answer): a 4xx error refuses the token (401), except 408 and 429, which count as `unavailable` (503) since a timeout or a rate limit does not judge the token; a status 0, none or a 5xx is `unavailable`; an answer without a user is `refused`. `toDeletionOutcome` (the `deleteUser` answer): no error is `deleted`; a 404 or the code `user_not_found` is `not-found`; anything else `failed`.
- Request checks: the `Bearer ` scheme is matched case-sensitively (`bearer <token>` gets 401); a blank env value (white space only) counts as missing.
- Gateway: with `verify_jwt = true`, a request without a valid JWT gets a 401 from the gateway with the gateway's own body, not the function's, so the client maps a 401 by its status alone.
- Client (`account-deletion.ts`): the session read before the request is bounded by `ACCOUNT_DELETION_TIMEOUT_MS` too (a stalled secure store gives `network`, nothing sent), and so is the read of an error body for the report's `code`: each of the three steps has the bound, so the worst case is three times it. The five fixed error codes of the function are copied as a client constant (`FUNCTION_ERROR_CODES`), since `src/core/` cannot import `supabase/functions/`: the two lists must stay in sync (a check is backlog item A-10). Its tests run a real supabase-js client against an MSW stand-in of the function (`src/core/repositories/supabase/__fixtures__/delete-account-function.ts`), not a fake client.
- Offline account library after a purge: a direct write whose answer comes back after the purge rejects `signed-out`, its outcome neither stored nor queued; a replay run waiting in its retry delay ends `signed-out` at once (the closing cuts the wait); a storage failure during the purge still tries both deletions, then throws the first error, the coordination staying closed, and the device purge reports it as its `account-library` step. The device reads of an instance moved from `account-library.ts` to `account-library-device.ts`.
- Sign-out sync (found by the route tests): the live writer is flushed again after the replay, and the unsynced count adds its `pendingChangeCount()` (changes in their coalescing window or being written), so a `+1` made while the sync ran is asked about, never dropped silently; the writer is flushed only once the merge concluded, since the pending library's reads never settle. A failed sync step is reported as a `SignOutSyncError` (fixed message, no cause). Residual: a change made while the `signOut()` request itself is in flight is dropped by the purge.
- Review (2026-11-03): a `getUser` answer with the code `user_not_found` is `gone` and answers `{"deleted":true}` without calling `deleteUser`, so a retry after a lost answer completes the client side; the gateway and the auth server checked the token's signature first, and the answer only tells the token's holder that its user is gone (`session_not_found` stays refused). `SignOutSyncError` lives in `src/core/errors/sign-out-errors.ts`. The Deno entry is never typechecked by the app tooling (no `deno check` in CI yet, A-10): the owner's `functions serve` check before the first deploy covers it.
- Next page prefetch (found by the route tests): a prefetch answering after the purge removed every query, before the search screen remounted, stored the previous user's search again; it now stores nothing once aborted or when the query of the page shown is gone (`use-prefetch-next-page.ts`).
- Hooks: both hooks read the session's account instance and the merge status through `useLatest` (`src/core/hooks/use-latest.ts`, a ref of the last committed value read after an await): the instance is the one of the call start, the merge status the one when the guest library rule is decided. A sync step that rejects is reported with `{ source: 'sign-out', tags: { step } }`, `step` `flush` or `replay`.
- Screens: signed out, `DeleteAccountScreen` offers Sign in (no deletion action). Once the deletion succeeded, its deleted state shows first (the device is then signed out) and goes back to Settings on its Back button (`router.dismissTo('/settings')`), not by itself. `account-deletion-error-keys.ts` maps each reason to its translation key (anything else reads as `unknown`); `settings-routes.ts` holds `DELETE_ACCOUNT_PATH`. `AccountSection` disables Delete account while a sign out runs.
- PKCE verifiers (the "Kept" table): supabase-js 2.117.3 deletes every verifier slot, the flow index and the fixed verifier key whenever it removes the session, so after a sign out the secure store holds neither a session nor a verifier. Only a slot written by a flow started while the session was being removed can stay (a trade-off supabase-js documents): random, no personal data.

## Consequences

- Maintainability: one Edge Function (a tested pure handler and a thin Deno entry), a client call in its own file, two error modules, the purge function and its provider, two hooks and one screen. No migration. `ARCHITECTURE.md` §2, §4, §5, §6, §8, §9, §10 and §12 and the A-09 backlog item record the new parts. This ADR completes ADR-0017 "Left to A-06" and the sign-out part of ADR-0016.
- Security: the deletion acts only on the verified token's own user, the service role key stays in the function env, bodies are fixed, nothing is logged, no CORS. Sign out leaves no user data of that user on the device, except the guest entries an unfinished merge still needs. Accepted: deletion without re-authentication on an unlocked device; Apple revocation deferred to A-09.
- Performance: the purge is a few synchronous deletes plus the cache removal; sign out waits for the sync at most 10 s; a deletion is one request bounded at 20 s.
- Product: new UI texts (sign out pending, unsynced confirmation, the deletion screen and its errors) in en and fr. A user with unsynced changes chooses knowingly.
- Future web app: the hooks, the purge and the client call are in `src/core/` over the existing seams (`StorageAdapter`, the persister); only the route and the screen are mobile. The function serves any client once a web ADR settles CORS.

## Update (2026-11-04)

From the A-06 review, done in A-10. The text above is kept as accepted; where it differs, this section applies.

### What the auth server answers

Checked against the local Supabase stack (the supabase CLI's auth server):

- After an admin delete, a token refresh with the user's refresh token answers 400 `refresh_token_not_found`, exactly as for a session revoked by a sign out.
- `GET /auth/v1/user` with the user's still-valid access token answers 403 `user_not_found` for a deleted user and 403 `session_not_found` for a revoked session; an expired or invalid token answers 403 `bad_jwt`.
- A refused refresh is therefore ambiguous and never purges by itself. The unambiguous signal is `user_not_found` answered for the session's own unexpired access token.
- auth-js 2.117.3 keeps the session when a proactive refresh is refused while the access token is still valid, and removes it once the token expired. Its auto refresh ticks every 30 s while the app is in the foreground and asks once fewer than four ticks remain, so 90 to 120 s before the expiry: the token is normally still valid at that moment.

### User gone detection (supabase layer)

- The supabase client's bounded fetch (`create-supabase-client.ts`) observes the answer status of the token refresh request (`POST <url>/auth/v1/token?grant_type=refresh_token`): a 4xx other than 408 and 429 is a refusal, signalled to the auth repository without reading the body or touching a token.
- On a refusal the auth repository reads the session (`getSession()`). With a session whose access token is unexpired, it asks `auth.getUser(accessToken)`; only an auth-js `AuthApiError` with the code `user_not_found` reports that session's user id gone. Anything else reports nothing: a success; `session_not_found` (auth-js then removes the revoked session itself, so it ends a little earlier, without a purge); `bad_jwt`; a 5xx; a network error; no session; an expired token. One probe at a time.
- New `AuthRepository` member: `onUserGone(listener: (userId: string) => void): () => void`. An id detected while no listener is subscribed is delivered to the next listener; the implementation decides the exact buffering.
- The `AuthRepository.signOut` contract now states that the implementation reports `unknown` itself, as `deleteAccount` does; `useDeleteAccount` relies on it to skip its own report of that reason.

### Purge-pending marker

- A document `device-purge-pending` in the app storage: `{ "version": 1, "users": [{ "userId": "<uuid>", "clearGuestLibrary": <boolean>, "deviceWide": <boolean> }] }`. It holds the user id, already part of the per-user storage keys, the guest-library decision and whether the device-wide steps are still owed; nothing else.
- Parsed with Zod on every read, the user id checked as a UUID. A damaged document reads as no marker and is reported once, never thrown.
- Interface `DevicePurgeMarkerRepository` (`src/core/repositories/`), synchronous like the storage; implementation in `src/core/repositories/local/`; the composition root wires it.
- Sign out: after the unsynced check and the guest-library rule (steps 3 and 4), the user's marker is written before `signOut()` (step 5). `signOut()` rejects: the marker is removed and the call rejects (still signed in, nothing purged, as before). It resolves: the device purge, then the marker is removed when the purge's `account-library` step succeeded; otherwise it is kept, so the next launch tries again, rewritten with `clearGuestLibrary` and `deviceWide` false: the device-wide steps have run once, and a retry must not clear guest entries or recent searches added after the sign out.
- Launch: once the auth state is known, once per app process. A marked user who is the session's user is unmarked: that sign out did not complete, and the user is still signed in. Every other marked user gets the device purge with the recorded `clearGuestLibrary` and `deviceWide` (the device-wide steps only when no user is signed in, "Device purge" below), then is unmarked when the `account-library` step succeeded, else rewritten with both flags false. This covers the app killed, or the `account-library` step failing, between `signOut()` and the purge.
- Account deletion keeps its order (the purge before the local sign out) and writes no marker.

### Purge of a gone user (hooks)

For a user X reported gone:

1. The marker of X is written, with `clearGuestLibrary` from the guest library rule (sign out step 4) when X is the session's user, else false, and `deviceWide` true.
2. When X is the session's user, `signOut()` ends the local session; a rejection is reported and the flow goes on, since the account is gone.
3. The device purge of X: X's documents through a new instance of X's offline account library from the factory, whose purge closes every instance of X.
4. X is unmarked when the `account-library` step succeeded, else its marker is rewritten with both flags false, as for a sign out.

Another user's documents are never touched: every per-user step takes X's id only.

### Device purge

- `purgeDeviceUserData` resolves the list of the steps that failed (it still never rejects) and takes `deviceWide: boolean`. False runs the `account-library` step only: no guest library, recent searches, caches or generation.
- The launch and gone purges run the device-wide steps only when no user is signed in at that moment, so a user signed in meanwhile keeps their recent searches and caches. The sign out and the account deletion always run them.

### Residuals

This updates "Residuals (accepted)":

- "A deleted user's other devices" and "A deletion whose answer is lost" are now covered whenever a refresh of that session is refused while its access token is valid (the app in the foreground before the expiry).
- Still not covered: a session whose token expired while the app was closed or in the background before any refused refresh. The refresh is then the only check, and it cannot tell a deleted account from a revoked session: the session ends without a purge and the queue waits, as ADR-0017 requires.
- Also: a sign out killed inside `signOut()`, after the server revoked the session and before supabase-js removed it locally, relaunches signed in, so its marker is cleared; the session then ends at its next refresh without a purge (rare).
- "The app killed, or the `account-library` purge step failing, after `signOut()` removed the session and before the device purge ran" is closed by the marker.

### Deletion screen

While `deletion.isError`, `DeleteAccountScreen` shows the failed deletion's translated error inside its signed-out state (a lost answer followed by a failed token refresh, or the account deleted on another device), so the user is told the outcome is unknown.

### Error codes and handler tests

- The fixed error codes of the `delete-account` function (`RESPONSES` in `supabase/functions/delete-account/handler.ts`) and the client's copy (`FUNCTION_ERROR_CODES` in `src/core/repositories/supabase/account-deletion.ts`) are kept in sync by a test comparing them; the implementation decides where it lives under the lint layer rules.
- The handler tests now feed the shapes auth-js produces: an `AuthSessionMissingError` (status 400, no code) for a revoked session, an `AuthApiError` 403 `user_not_found` for a deleted user.

### `deno check`

Not added to CI: the setup-deno GitHub Action is a third-party action, a new dependency the owner has not approved. Until then the owner runs `deno check supabase/functions/delete-account/index.ts` (Deno 2) before each deploy of the function, as a step of `ARCHITECTURE.md` §10, besides the `functions serve` check. Moving it to CI stays a backlog item.

### Precisions from the implementation

What the implementation decided where this Update left it open, and one deviation.

Refusal signal:

- `createTokenRefreshRefusalSignal()` (`src/core/repositories/supabase/token-refresh-refusals.ts`) links the two ends: the composition root creates one, passes its `notify` as `onTokenRefreshRefused` of `createSupabaseClient` and the signal itself as `refreshRefusals` of `createSupabaseAuthRepository`, so neither module knows the other. A refusal carries nothing; one told before the repository subscribed is lost.
- The bounded fetch matches the exact refresh URL, built as supabase-js builds it (`tokenRefreshUrl`: `new URL('auth/v1', <url with a trailing slash>)`, then `/token?grant_type=refresh_token`, compared as a whole string) with the method `POST`, and calls the observer in a microtask; the response reaches auth-js unchanged. Without `onTokenRefreshRefused` nothing is observed; without `refreshRefusals`, `onUserGone` never reports.

Detector (`src/core/repositories/supabase/user-gone-detector.ts`):

- The session parts the check reads (`access_token`, `expires_at`, a UUID `user.id`) are parsed with Zod; a session without them is never checked.
- It may report a user again on a later refusal while that session is still on the device (a `signOut()` that rejected). The driver queues nothing for a user whose purge is queued or running; a repeat after it purges again, harmlessly.
- Buffering: while no listener is subscribed, up to `MAX_PENDING_GONE_USERS` (4) ids are kept, the most recent, each once; they are delivered once, in a microtask, to the next listener only, then forgotten.
- A check that throws, or a listener that throws, is reported as an `AuthError('unknown')` with the operation `user-gone` only; the other listeners are still called.

Markers:

- `DevicePurgeMarkerRepository` (`src/core/repositories/device-purge-marker-repository.ts`) and `createLocalDevicePurgeMarkerRepository(storage, { reporter })` (`src/core/repositories/local/device-purge-marker-repository.ts`), report source `device-purge-marker`. Errors in `src/core/errors/device-purge-errors.ts`: `DevicePurgeMarkerError` for the problems of a damaged document (`invalid-json`, `invalid-envelope`, `invalid-markers`, `duplicate-users`), `DevicePurgeMarkerOperationError` for a call that failed (`list`, `add`, `remove`); each holds its problem or operation only.
- "A damaged document reads as no marker" holds for invalid JSON and an invalid envelope (an unknown version included). An invalid element is dropped and the others are kept; a user named twice keeps the last marker, at the position of the first. Each problem is reported once per instance, and the next write replaces the document with what could be read. `add` and `remove` throw a `RangeError` without a value for a user id that is not a UUID, before any write.
- `guardDevicePurgeMarkers(markers, reporter)` (`src/core/hooks/device-purge-markers.ts`) never throws: a failed call is reported, `list` then answering none. `settle(userId, failed)` removes the marker when the `account-library` step is not among the failed steps, else rewrites it with both flags false.

Driver (`src/core/hooks/DevicePurgeDriver.tsx`), rendered by `DevicePurgeContextProvider`, which now takes `markers`:

- Ready once the session state is known and the persisted query cache was restored (`useIsRestoring()`), so no purge runs before a restore that would put purged queries back. The launch step runs once per mount (the composition root mounts it once per app process). It subscribes to `onUserGone` only once ready; ids detected before are kept by the detector.
- Purges are serialized; a user whose purge is queued or running is skipped. The user's account instance is created inside the `account-library` step, so a factory that throws is a failed step and the marker stays. A purge that rejects anyway (unexpected) is reported with `{ source: 'device-purge-driver' }`, and the next one still runs.
- Deviation from "Device purge" and "Launch" above: the device-wide steps of a launch or gone purge run when no other user is signed in when the purge starts (no session, or the purged user's own), not "when no user is signed in". The case it changes: the session's user X reported gone whose `signOut()` rejected is still signed in, and still gets the guest library rule, the recent searches, the caches and the generation purged, since the account is gone and those data are X's. X's account instances are closed by the purge, so X's library calls end `signed-out` until the session ends at its next refresh.
- `SessionLibraryValue` gains `userId` (the user of `account`, null exactly when it is; the sign out marks it) and `accountRepositoryFor` (the factory the driver creates a purged user's instance from). `PENDING_LIBRARY_REPOSITORY` moved to `src/core/hooks/pending-library.ts`.
- `src/core/hooks/sign-out-failure.ts` (`reportSignOutFailure`) shares the report of a local sign out that rejected after a deletion (source `account-deletion`) or a gone report (source `device-purge-driver`), skipping the `unknown` the repository already reported.

Residuals found while implementing:

- Narrow race: auth-js removes whatever session is stored when `getUser(jwt)` answers `session_not_found`. An account switch between the check's session read and that answer could therefore end the new session. Nothing is lost: that session's queue is kept for its next sign in. Tracked with the security review (R-04).
- Wording: the deletion screen now shows the failed deletion's error in its signed-out state, where the `sessionExpired` text ("Sign out, sign in again, then try again") reads oddly, the user being signed out already. Tracked in the backlog (R-03).
- The driver tests do not cover ids buffered between the driver's mount and its readiness; the detector's tests cover the buffering itself. Tracked in R-04.
