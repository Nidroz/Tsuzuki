# ADR-0020: Encrypted app storage

- Status: Accepted
- Date: 2026-11-11

## Context

R-04 reviews the unencrypted MMKV instance (F-09, owner decision; `docs/BACKLOG.md` R-04, `docs/security-review.md` MASVS-STORAGE-1). The app storage is one MMKV instance, `tsuzuki` (`createStorage()`, `src/platform/storage.ts`), unencrypted, behind the core `StorageAdapter`. It holds:

- the preferences (`preferences.theme`, `preferences.language`, `preferences.showAdult`, L-06);
- the persisted query cache (`query-cache`: catalog queries only; library keys and search queries are never persisted, `ARCHITECTURE.md` §6);
- the recent searches (`recent-searches`, C-04);
- the guest library (`guest-library`: titles, progress, scores, notes, favorites, L-02);
- per signed-in user id, the account library's device copy and write queue (`account-library-copy.<userId>`, `account-library-queue.<userId>`: the same data, the unsynced writes included, A-05, ADR-0017);
- the purge-pending markers (`device-purge-pending`: user ids and two flags each, A-10, ADR-0018).

Never the session or the PKCE verifiers, which are in the secure store (`ARCHITECTURE.md` §8; `src/core/repositories/supabase/session-isolation.test.ts`). Notes are free text the user writes. The OS sandbox keeps other apps out, but the file is readable outside the app's own process by a device backup (iCloud or a computer backup on iOS; Android auto backup, which `configureAndroidBackup` of `expo-secure-store` excludes the secure store from, not the MMKV files), on a rooted or jailbroken device, and by a forensic extraction.

Constraints:

- `StorageAdapter` is synchronous (`getString`, `set`, `delete`). The composition root opens the storage at module level, the preferences are loaded synchronously on mount so the first frame uses them, and the guest store, the offline account library and the marker repository read, change and write synchronously inside each call (`ARCHITECTURE.md` §4). The key must therefore be known synchronously before the first read.
- `expo-secure-store` (SDK 57) has synchronous `getItem` and `setItem`, with the accessibility the session uses (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
- react-native-mmkv 4.3.2 opens an instance with `createMMKV({ id, encryptionKey, encryptionType: 'AES-256' })` (a key of at most 32 bytes), has `existsMMKV` and `deleteMMKV`, and can change the key of an open instance in place (`recrypt`, `encrypt`).
- A new key needs a cryptographically secure random source. Neither React Native 0.86 nor the Expo SDK 57 runtime installs `crypto.getRandomValues` on Hermes ("Open question").
- Installed builds (preview, development) hold their data in the plain `tsuzuki` instance: it must move without loss, whatever the point at which the app is killed.

Options considered:

- **(a) MMKV `encryptionKey`, a random key kept in the secure store, one new encrypted instance, the plain instance copied into it once**: chosen by the owner.
- **(b) Encrypting the existing instance in place (`recrypt` / `encrypt`)**: rejected, not crash-safe. MMKV rewrites the file under the new key: a kill during the rewrite, or between the rekey and the write of the key to the secure store, leaves a file that no stored key opens, and everything in it is lost.
- **(c) A plain instance kept for the preferences**, read before the key: not needed. The key is read synchronously before anything reads the storage, so the preferences can live in the encrypted instance, and one instance keeps one storage seam.
- **(d) Excluding the MMKV files from backups**, instead of or besides the encryption: needs native configuration (the iOS backup exclusion attribute on the MMKV folder, Android backup rules for it) and a new build. With the key never leaving the device, a backup holds only ciphertext, and an exclusion alone leaves the file readable on the device. Not done.
- **(e) Another encrypted engine (SQLCipher) or per-document encryption in JavaScript**: a new storage engine, or JavaScript cryptography on every read and write. Rejected.
- **(f) A key derived from a user secret**: guests have none, and it would ask for a secret at every launch. Rejected.

## Decision

Built in `src/platform/` (`app-storage.ts`, `app-storage-key.ts`, `app-storage-instance.ts`, `app-storage-migration.ts`, `memory-storage.ts`), with the error module `src/core/errors/app-storage-errors.ts`. **Not wired**: `app/_layout.tsx` keeps `createStorage()` until the random source is decided ("Open question").

### Interface

```ts
type GetRandomValues = (array: Uint8Array) => Uint8Array; // the web crypto signature; expo-crypto has the same
interface AppStorageOptions { readonly reporter: ErrorReporter; readonly getRandomValues: GetRandomValues }
openAppStorage(options: AppStorageOptions): StorageAdapter;
```

Called once per process by the composition root, before anything reads the storage, in place of `createStorage()`. `getRandomValues` is used only to create a key. `StorageAdapter` is unchanged; `src/core/` does not change.

### Key (`app-storage-key.ts`)

- 32 bytes from `getRandomValues`, one character per byte from the URL-safe base64 alphabet `A-Za-z0-9-_`: 64 characters, and 256 is a multiple of 64, so the low 6 bits of each byte pick every character with the same probability. 32 characters (`APP_STORAGE_KEY_LENGTH`, the most MMKV's AES-256 takes), 192 bits. A source that returns another array (another length included), detaches the one it was given, or leaves it all zeros throws a `RangeError` that holds no byte; `openAppStorage` then runs on memory with `key-unavailable`, no key stored and no file opened.
- Stored in the secure store under `APP_STORAGE_KEY_NAME` (`tsuzuki-app-storage-key`, a name no session key takes) with `APP_STORAGE_KEY_OPTIONS` (`keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`, like the session): readable only while the device is unlocked, never restored on another device.
- Read synchronously once per process and kept in memory (by the open instance): the app also writes when it goes to the background (the background flush of the library writer), possibly while the device locks.
- A stored value is untrusted: `appStorageKeySchema`, exactly 32 characters of the alphabet; anything else reads `invalid`.

### Instance (`app-storage-instance.ts`)

- One instance, `APP_STORAGE_INSTANCE_ID` (`tsuzuki-encrypted`), `encryptionType: 'AES-256'`, for everything the app stores, the preferences included.
- Reserved keys under `app-storage.` (`RESERVED_KEY_PREFIX`): no `StorageAdapter` consumer writes under it, and the copy below skips it. `app-storage.check` (`KEY_CHECK_KEY`, value `tsuzuki-app-storage-check`) is written right after a new instance is created, before anything else; an existing instance that does not read it back was opened with another key: it is cleared (`clearAll`), the check value written, and `key-mismatch` reported. `app-storage.migrated` (`MIGRATED_MARKER_KEY`, value `copied`) marks the copy done.

### Launch (`openAppStorage`)

1. The key is read. A secure store that cannot be read (a locked device, a keychain or keystore failure): `key-unavailable`, and this process runs on `createMemoryStorage()` with every file untouched (a locked device is not a lost key).
2. A valid key opens the instance (step 4).
3. No key, or an invalid one: an existing encrypted instance can never be read again, so it is deleted (`deleteMMKV`; a failed deletion is left to the key check of step 4, which clears what is left) and reported, `key-invalid` for an invalid key, `key-lost` for no key while the instance existed (a first launch reports nothing). Then a new key is generated and stored, before the instance is created: an encrypted file never exists without its key stored. A random source or a secure store write that fails: `key-unavailable`, memory storage, no file opened.
4. `openEncryptedInstance(key)`: a new instance gets the check value; an existing one is checked (above). Opening or the check write throwing: `open-failed`, memory storage, the key kept for the next launch.
5. `migrateLegacyStorage(encrypted)`:
   - no plain instance (`existsMMKV('tsuzuki')` false): the encrypted instance is the storage;
   - a plain instance without the marker: it is opened; unless the plain instance itself is marked copied (below), every non-reserved key of the encrypted instance is removed first, then every string value of the plain instance is copied except the reserved keys, then the marker is written in the encrypted instance and the copied marker (`app-storage.copied`) in the plain one. The encrypted instance is the storage, and the plain file stays on disk for this launch. Before the marker nothing but the copy writes the encrypted instance, so a copy killed half-way is simply done again, and the removal first means a key deleted meanwhile (a sign out purge while a failed copy left the process on the plain instance) is never brought back;
   - a plain instance marked copied without the encrypted marker (the encrypted instance was reset after the copy: a lost, invalid or mismatched key): nothing is copied or removed, its stale values never come back (they would undo the purges made since the copy); only the encrypted marker is written, and the next launch deletes the plain file without opening it;
   - a plain instance with the marker: it is deleted without being opened; a failed deletion is reported (`legacy-delete-failed`) and retried at the next launch;
   - a copy that throws: `migration-failed`, and the plain instance stays the storage of this process, as before this change (the next launch removes the partial copy and copies it again); a plain instance that cannot be opened, or whose copied marker cannot be read: memory storage, nothing deleted; a copied marker that cannot be written in the plain instance: `migration-failed`, the encrypted instance stays the storage (the encrypted marker alone deletes the plain file at the next launch); an encrypted marker that cannot be written over a plain instance marked copied: `migration-failed`, the encrypted instance stays the storage and the next launch writes the marker without copying.
   - Why the next launch deletes the plain file: MMKV destroys an open instance when it is deleted, while react-native-mmkv's app state listeners keep calling every instance created in the process. The launch that copied keeps the file; the next one deletes it without opening it.
   - A key lost while the plain instance is still there: before a complete copy, the new encrypted instance gets the plain values copied again, so nothing of the plain instance is lost; after it, nothing is copied (above).

### Reports

Every problem is an `AppStorageError(problem)` (`APP_STORAGE_PROBLEMS`: `key-unavailable`, `open-failed`, `key-invalid`, `key-lost`, `key-mismatch`, `migration-failed`, `legacy-delete-failed`; a fixed message per problem, no cause) reported with `{ source: 'app-storage' }` (`APP_STORAGE_REPORT_SOURCE`). The caught keychain, random source or MMKV error is dropped, never reported: it could quote the key or a stored value.

### Backups

Not excluded. The encrypted files are useless without the key, and the key never leaves the device: `WHEN_UNLOCKED_THIS_DEVICE_ONLY` items are never restored on another device, and Android auto backup excludes the secure store (`configureAndroidBackup`, `app.config.ts`). A backup restored on another device finds the files without their key: `key-lost`, reset. Excluding the files would need native configuration and a new build (option d).

### Wiring, once the random source is decided

- The composition root calls `openAppStorage({ reporter, getRandomValues })` where it calls `createStorage()` today, after the reporter is created and before the persister, the preferences and the repositories read the storage.
- `createStorage()` and `STORAGE_INSTANCE_ID` stay for the migration (the id of the plain instance) until no installed build can hold a plain instance.
- Native build: none for these modules (react-native-mmkv 4.3.2 and `expo-secure-store` are native modules of the current builds); the random source dependency needs one.

## Open question: the random source

The device has no cryptographically secure random source today: neither React Native 0.86 nor the Expo SDK 57 runtime installs `crypto.getRandomValues` or `crypto.subtle` on Hermes. `openAppStorage` takes the source as an option so that the module does not choose it.

The same gap affects the auth client today (finding of R-04, `docs/security-review.md` MASVS-CRYPTO-1): auth-js 2.117.3 (`generatePKCEVerifier`, `generatePKCEFlowId` and `generatePKCEChallenge` in `lib/helpers.js`) falls back to `Math.random` for the PKCE verifier and the flow id, and to the `plain` challenge method (its "WebCrypto API is not supported" warning). Severity Medium (MASVS-CRYPTO-1, MASVS-AUTH-1): the email links still need the verifier, which is sent only over TLS, but a verifier drawn from `Math.random` is predictable in principle, and `plain` puts the verifier itself in the request. It must be fixed before A-09 ships OAuth, where the authorize URL holding a `plain` challenge goes through the browser.

Proposed (owner decision pending: a new dependency): `expo-crypto` (Expo-maintained), behind a small platform polyfill imported first by the root layout, which installs `crypto.getRandomValues` and `crypto.subtle.digest` (SHA-256) before the supabase client is created; the same `getRandomValues` is the key source of this ADR. A new native build. Tracked as backlog item R-09.

## Consequences

- Security: the library data, the device copies and queues, the recent searches, the cache and the preferences are encrypted at rest with a device-bound key (MASVS-STORAGE-1, the backup part of MASVS-STORAGE-2). The key is never logged, reported or put in an error. MMKV's AES (CFB mode, as MMKV implements it) gives confidentiality, not integrity: a tampered file decrypts to garbage, which the Zod parse of every document read drops (`ARCHITECTURE.md` §4), and a wrong key is caught by the check value. Until the wiring, the instance stays unencrypted and the plaintext stays in backups.
- Data: a lost key (a keychain reset, a backup restored on another device, an invalid stored value) loses everything the encrypted instance held: the guest library, the account device copies and their unsynced queued writes, the purge markers (with the documents they would purge), the recent searches, the persisted cache and the preferences. The account library itself is on the server. The plain instance of an older version is never lost: it is deleted only after a complete copy marked done.
- Accepted residuals:
  - a persistent secure store read failure on Android (a damaged keystore entry) runs the app on memory at every launch, reported `key-unavailable` each time, with nothing persisted (the guest library, the preferences, the offline copy and queue last until the process ends), until the app data is cleared;
  - a kill between the creation of a new instance and its check value gives a false `key-mismatch` at the next launch: the instance held nothing yet, so nothing is lost;
  - after the copy, the plaintext file stays on disk until the next launch deletes it;
  - a plain instance left unmarked while a process runs on the encrypted instance (its copied marker write failed, or a kill between the two markers followed by a failed deletion of the plain file), then a key lost before the plain file is deleted: the plain values are copied again into the reset instance, undoing the purges made since the copy (R-09: write the plain marker before the encrypted one). A kill between the two markers alone does no harm: no process ran on the encrypted instance;
  - to decide before the wiring: while a process runs on memory (`key-unavailable`, `open-failed`, a plain instance that cannot be opened), a sign out, an account deletion or a gone purge acts on memory only: the files keep that user's copy and queue, the recent searches, the cache and the guest library, with no marker, and the next launch that reads the key shows them again (the guest library could then be merged into the next account). The wiring must make those purges refuse or warn while on memory, or record the owed purge somewhere that lasts (R-09);
  - a process started while the device is locked could not read the key and would run on memory; no such launch exists today (no background mode, no push notification).
- Performance: one synchronous secure store read at each launch, on the JavaScript thread before the first frame (measured on a device in R-07); a key write at the first launch; once per install, the copy of the plain instance (its documents' size: about 523 bytes per device copy entry, `ARCHITECTURE.md` §6 "Performance baseline") and a file deletion at the next launch; AES in native code on every MMKV read and write, small next to the Zod parse that dominates the library store costs.
- Maintainability: five platform modules and one core error module; `StorageAdapter`, the repositories and the hooks unchanged. The reserved prefix `app-storage.` must stay unused by every `StorageAdapter` consumer.
- Future web app: unaffected; `src/core/` sees only `StorageAdapter`, and a web storage decides its own protection at rest.

## Tests

Jest, project `mobile`, over an in-memory device (`src/platform/__fixtures__/app-storage-device.ts`: MMKV files per instance id with the key that wrote them, the secure store, failure injection and an event log; `app-storage-launch.ts`, `app-storage-reports.ts`); the files outlive the instances, so calling `openAppStorage` again is the next launch.

- `app-storage.test.ts`: first launch (the key from the injected source, stored before the instance is created; one AES-256 instance with the check written first; values stored encrypted); a stored key (no new key, no secure store write; read again at the next launch; an instance missing its files, the keychain having outlived a reinstall, opened as new); a key that does not open the instance (MMKV discarding the file or decrypting garbage: cleared, `key-mismatch`, clean at the next launch).
- `app-storage-reset.test.ts`: a lost key (reset, reported, never thrown; the old files deleted, then the key stored, then the instance created; a failed deletion cleared by the key check; a kill after the deletion or after the key write); an invalid key.
- `app-storage-failures.test.ts`: the key unreadable (memory, no file touched, a lost key's files kept), unwritable, the random source failing; an instance that fails to open (memory, the key kept and used at the next launch), an existing one that fails to open, a check value that cannot be written.
- `app-storage-key.test.ts`: the key from the bytes, the low 6 bits, the stored form, a source returning another array, detaching it or filling nothing, each refused quoting no byte; the schema; reads and writes with the session accessibility.
- `app-storage-migration.test.ts`: every value copied then the marker, the plain instance kept by that launch and deleted by the next without being opened, reserved keys never copied; a copy killed half-way (the plain instance the storage of that process, completed at the next launch with no loss); a plain instance that cannot be opened (memory, nothing deleted); a copy marked done never repeated; a failed deletion reported and retried; a key lost, or mismatched, while the plain instance remains (copied again before a complete copy); a key deleted by the fallback process not brought back by the next copy.
- `app-storage-migration-reset.test.ts` (with `__fixtures__/app-storage-legacy.ts`): a lost or mismatched key after a completed copy (nothing copied again, the plain file deleted by the following launch), marker write failures (the encrypted marker failing after a fresh copy is not tested yet: R-09), and a kill between the two markers.
- `memory-storage.test.ts`; `src/core/errors/app-storage-errors.test.ts` (a fixed message per problem).

## Owner steps once decided

1. Decide the random source (R-09): approve `expo-crypto`, or another source.
2. Then, in one PR (R-09): `pnpm exec expo install expo-crypto` with its justification (`CONTRIBUTING.md` §7); the platform polyfill and its tests (a PKCE request sending an S256 challenge); `openAppStorage` wired in the root layout with its route test; this ADR's status set by the owner.
3. A new EAS development build before the next E2E run (ADR-0019 prerequisite), and a preview build.
4. Device checks on the preview build (R-07): an upgrade over a build holding data (the data still there, the plain file gone at the second launch), a fresh install, the launch time; the auth-js WebCrypto warning gone.

## Update (2026-11-15)

From the security follow-ups (R-09). The text above is kept as accepted; where they differ, this section applies.

### Random source

The open question is closed: `expo-crypto`. Its `getRandomValues` behind the Web Crypto contract, `secureRandomValues` (`src/platform/web-crypto.ts`), is the key source, and the same function the root layout installs as `crypto.getRandomValues` for auth-js (ADR-0014, Update of 2026-11-15, which also covers the PKCE gap described in "Open question").

### Wiring

- `app/_layout.tsx` calls `openAppStorage({ reporter, getRandomValues: secureRandomValues })` once at module level, after the reporter and before the persister, the preferences and the repositories read the storage. This replaces "Not wired" (Decision) and "Wiring, once the random source is decided".
- It returns `AppStorage { storage, persistent, firstLaunch }` (`src/platform/app-storage.ts`) in place of a `StorageAdapter` (Interface): `storage` is the encrypted instance, the plain one while its copy is not complete, or memory; `persistent` is false exactly when the process runs on memory; `firstLaunch` is true when neither the encrypted nor the plain instance existed as the call started. MMKV that cannot tell whether the files exist (`existsMMKV` throwing) is not trusted to open them: memory, `open-failed`, the key and every file untouched, and `firstLaunch` false, the conservative value (true would write a new key over one that may open existing files, and discard a session on a guess).
- `createStorage()` and `src/platform/storage.ts` are deleted; `STORAGE_INSTANCE_ID` (`tsuzuki`) moved to `app-storage-migration.ts`. This replaces the second bullet of "Wiring". Precondition: nothing but the migration ever opens the plain instance; the composition root has no other way to open it.

### First launch

- A first launch never reads the stored key: with no file, a key found is stale (the iOS keychain outlives an uninstall), and a new one is written over it before the instance is created.
- The session storage is created with `createSecureSessionStorage(reporter, { discardStored: firstLaunch })` (`src/platform/secure-session.ts`, `discardStoredKey` in `secure-session-sweep.ts`): the first access of each key in the process removes whatever it holds (the header first, then the chunks of both generations and the F-09 keys, then the cleanup marker). A reinstall starts signed out and never reads a stale session, PKCE verifier or flow index. A failed discard is reported with a fixed error (`SecureSessionDiscardError`, no cause, no value); that access fails closed (a read resolves null, a write or a removal rejects, changing nothing) and the next access retries.
- The owed purges of an earlier install are dropped (below).
- Residual: verifier slots listed only in a discarded flow index stay orphaned in the keychain, never read; their codes are long expired.

### Copy order and fresh install marker

`migrateLegacyStorage` (`src/platform/app-storage-migration.ts`) now writes the plain copied marker first, then makes the encrypted instance the storage, then writes the encrypted marker. This replaces the marker order and the two marker failure cases of Launch step 5:

- a plain marker that cannot be written: `migration-failed`, the process stays on the plain instance, copied again at the next launch;
- an encrypted marker that cannot be written: `migration-failed`, the process stays on the encrypted instance, marked without a copy at the next launch.

No process runs on the encrypted instance while the plain one is unmarked, so the residual "a plain instance left unmarked …, then a key lost before the plain file is deleted" (Consequences) is closed.

Fresh install marker: with no plain instance, the encrypted marker is written too (a fresh install, or an encrypted instance reset after the plain one was deleted). A plain instance found later is deleted unopened at the next launch, never copied over what the encrypted instance holds.

### Purges while on memory

This settles the residual "to decide before the wiring" (Consequences): a purge on memory now records what it owes to the files.

- While `persistent` is false, the composition root passes `owedPurges` to `DevicePurgeContextProvider`: a `createLocalDevicePurgeMarkerRepository` (the core marker repository, unchanged) over `createSecureDocumentStorage()` (`src/platform/secure-documents.ts`). That storage is a synchronous `StorageAdapter` over `expo-secure-store`, names under `tsuzuki.documents.`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, at most 2048 UTF-8 bytes per value (about 20 users), a deletion written as an empty tombstone since `expo-secure-store` 57 has no synchronous delete.
- A sign out and a gone purge record it together with the purge-pending marker, before `signOut()` ends the session (`useMarkDevicePurge`, `use-device-purge.ts`): from the review of R-09, since the marker itself lands in memory, a record made only by the purge left nothing after a kill inside `signOut()`, which can wait up to the 30 s fetch bound. A sign out that rejects while still signed in removes the marker and keeps the record: the next launch on the files restores the session and unmarks the user; one that cannot restore it purges that user's files, the queue included (accepted, the user asked to sign out).
- Each device purge (sign out, account deletion, gone, launch) also records, synchronously and before any step (the only record for the deletion and the launch purge), `{ userId, clearGuestLibrary: false, deviceWide }` in `tsuzuki.documents.device-purge-pending`, `deviceWide` true if already owed or if this purge runs the device-wide steps (`guardOwedDevicePurges`, `src/core/hooks/owed-device-purges.ts`). A failure is reported `DevicePurgeMarkerOperationError('owe')`, never thrown, and the purge still runs on memory.
- `settleOwedDevicePurges`, at module level in the composition root before the tree mounts: a first launch removes every owed purge (the files are new: kept, they would purge the new install's device-wide data); a launch on the files carries each into the purge-pending markers (`deviceWide` OR-merged with the existing marker, `clearGuestLibrary` the existing marker's or false), then removes it, a failure being reported `carry` and that record kept; a launch on memory leaves them. `DevicePurgeDriver` then applies the markers with its existing rules (ADR-0018, Updates of 2026-11-04 and 2026-11-11): the session's user is not purged, and the device-wide steps run only with nobody else signed in.
- `clearGuestLibrary` is false because the memory process merged only its memory guest library; the guest library of the files stays under its own rule.
- Consequence: that next-launch purge also deletes the user's queued writes left in the files by an earlier launch, which the memory process could not count. The user asked for the sign out or the deletion, and ADR-0018 refuses notes at rest on a device that may be handed over.
- Cost: one synchronous secure store read at a launch on the files or a first launch (none on memory); two reads and one write per record while on memory: one for the account deletion and the launch purge, two for a sign out and a gone purge (with the marker, then by the purge), so four reads and two writes.
- Residuals (accepted):
  - an owed record whose removal fails after its carry is carried again at each launch, purging that signed-out user again, the device-wide steps included when nobody is signed in (R-10 decides whether it needs a fix);
  - a failed first-launch discard leaves stale records for a later launch to carry;
  - a user who signs in again during their purge on memory, and whose session then ends on its own, still gets their files purged at the next launch;
  - when memory comes from an unreadable secure store, the record fails too; only the `owe` report tells.

### Tests added

- `src/platform/app-storage-flags.test.ts`: `persistent` and `firstLaunch` (a stale key overwritten, never read; an upgrade is not a first launch; the plain fallback is persistent; MMKV in doubt runs on memory).
- `src/platform/app-storage-migration-markers.test.ts`: the copy order and both marker failures (the encrypted marker failing after a fresh copy, missing so far), a kill between the markers, the fresh install marker, a stray plain instance deleted unopened.
- `src/platform/secure-session-discard.test.ts`, `src/platform/secure-documents.test.ts`.
- `src/core/hooks/owed-device-purges.test.ts`, `src/core/hooks/DevicePurgeContextProvider.owed.test.tsx` (recorded before any step, never owing the guest library or lowering `deviceWide`, `owe` reported and the purge run, nothing recorded without `owedPurges`).
- `test/app/root-layout-app-storage-open.test.tsx` (the encrypted storage opened once with the secure source, the preferences read from it), `test/app/root-layout-app-storage.test.tsx` (the binding installed once before the supabase client, a first launch signed out, its owed purges dropped, a damaged owed document carrying nothing), `test/app/root-layout-owed-purges.test.tsx` and `root-layout-owed-purges-launch.test.tsx` (a purge owed on memory, carried and applied by the next launch, the guest library and other users kept).

### Owner steps left

These replace "Owner steps once decided":

1. A new EAS development build (`expo-crypto` is a native module) before the next E2E run (ADR-0019 prerequisite and Update of 2026-11-15), and a preview build. New builds only: no EAS update of this code targets older binaries (ADR-0014, Update of 2026-11-15).
2. The E2E suite re-run on a draft PR to `main`.
3. Device checks on the preview build, in R-07: the WebCrypto warning gone and `s256` sent; `TextEncoder` and `btoa` on Hermes; an upgrade over a build holding plain data (the data kept, the plain file gone at the second launch); a fresh install; an iOS reinstall starting signed out; the launch time with the key read.
