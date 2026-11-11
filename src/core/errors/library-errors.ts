// errors of the library repositories (docs/ARCHITECTURE.md §4). entries hold personal data (notes,
// titles): messages and fields never hold stored content, a title, notes or a media key, and no
// cause is attached, since these errors reach the error reporter

/**
 * why a library document on the device (the guest store, the account library's device copy or
 * write queue, ADR-0017) could not be read whole: the stored text is not json, the json is not a
 * version 1 envelope, some elements failed their schema and were dropped, or several elements had
 * the same key and only one was kept.
 */
export type LibraryStorageReason =
  'invalid-json' | 'invalid-envelope' | 'invalid-entries' | 'duplicate-keys';

/**
 * a library document on the device is damaged; reported, never thrown on read. it holds the
 * reason only: which document is a report tag.
 */
export class LibraryStorageError extends Error {
  readonly reason: LibraryStorageReason;

  constructor(reason: LibraryStorageReason) {
    super(`Library storage is damaged: ${reason}`);
    this.name = 'LibraryStorageError';
    this.reason = reason;
  }
}

/**
 * a media outside the database limits that no library snapshot can hold (toLibraryMediaSnapshot).
 * a RangeError, with a fixed message.
 */
export class LibrarySnapshotError extends RangeError {
  constructor() {
    super('Media snapshot is outside the database limits');
    this.name = 'LibrarySnapshotError';
  }
}

/**
 * the report source of the replay of the offline account library (ADR-0017): a run ended by an
 * unexpected error (the local store), and a run that rejected (the replay driver of the hooks).
 */
export const LIBRARY_REPLAY_REPORT_SOURCE = 'library-replay';

/**
 * the report source of a direct attempt of an offline account library write that failed with an
 * error the account store did not map (a bug), the write kept queued.
 */
export const LIBRARY_WRITE_REPORT_SOURCE = 'library-write';

/**
 * why a call of the account store failed (docs/ARCHITECTURE.md §4 "Account store"): no response, a
 * gateway status, a 408 or a 429 (`network`, transient); the session is no longer the store's user, or the token was
 * refused (`signed-out`); the database refused the request (`rejected`, a bug or a schema drift);
 * the database refused a new entry because the user's library holds LIBRARY_ENTRIES_PER_USER_MAX
 * entries already (`library-full`, a condition of the user, not a bug: never reported, and like
 * `rejected` the write is refused for good until the user removes entries); a row this version
 * cannot read (`invalid-row`); anything else (`unknown`).
 */
export const LIBRARY_REMOTE_REASONS = [
  'network',
  'signed-out',
  'rejected',
  'library-full',
  'invalid-row',
  'unknown',
] as const;

export type LibraryRemoteReason = (typeof LIBRARY_REMOTE_REASONS)[number];

const LIBRARY_REMOTE_MESSAGES: Readonly<Record<LibraryRemoteReason, string>> = {
  network: 'Account library unreachable',
  'signed-out': 'Account library session ended',
  rejected: 'Account library request rejected',
  'library-full': 'Account library is full',
  'invalid-row': 'Account library row is unreadable',
  unknown: 'Account library request failed',
};

/**
 * a failed call of the account library store. the message is fixed per reason; it holds no server
 * text (a postgres detail can quote the row), no key and no value, and no cause is attached.
 */
export class LibraryRemoteError extends Error {
  readonly reason: LibraryRemoteReason;

  constructor(reason: LibraryRemoteReason) {
    super(LIBRARY_REMOTE_MESSAGES[reason]);
    this.name = 'LibraryRemoteError';
    this.reason = reason;
  }
}
