// the library repositories (docs/ARCHITECTURE.md §4): the user's library entries, on the device
// for a guest (local/, L-02) and in supabase for a signed-in user (supabase/, A-03). types only
import type { LibraryEntry } from '../domain/library-entry';
import type { MediaKey } from '../domain/media';

/**
 * the library of the current user (FR-10 to FR-15, FR-20, FR-23). hooks depend on this interface
 * only; SessionLibraryContextProvider picks the implementation from the session state (the guest
 * store signed out, the account store of the signed-in user, A-03), and hooks do not know which
 * one they use. an instance holds one owner's library for its whole life: the account store is
 * created for one user id, and rejects every call once the session is no longer that user's.
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
 * the guest library (FR-20), kept on the device only (local/library-repository.ts). `clear` is
 * guest-only: the guest store is emptied after a successful merge into the account (BR-08, A-04:
 * the merge reads `list()`, sends every entry to the account side, and calls `clear()` only once
 * the account side accepted them all) and by the sign-out purge (FR-25, A-06). an account library
 * is removed by account deletion only (A-06).
 */
export interface GuestLibraryRepository extends LibraryRepository {
  /** removes every guest entry; a no-op when there is none. */
  clear(): Promise<void>;
}
