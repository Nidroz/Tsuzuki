// errors of the library repositories (docs/ARCHITECTURE.md §4). entries hold personal data (notes,
// titles): messages and fields never hold stored content, a title, notes or a media key, and no
// cause is attached, since these errors reach the error reporter

/**
 * why the guest store could not be read whole: the stored text is not json, the json is not a
 * version 1 envelope, some entries failed the entry schema and were dropped, or several entries
 * had the same key and only the most recent was kept.
 */
export type LibraryStorageReason =
  'invalid-json' | 'invalid-envelope' | 'invalid-entries' | 'duplicate-keys';

/**
 * the guest library store is damaged; reported, never thrown on read. it holds the reason only.
 */
export class LibraryStorageError extends Error {
  readonly reason: LibraryStorageReason;

  constructor(reason: LibraryStorageReason) {
    super(`Guest library storage is damaged: ${reason}`);
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
 * why a call of the account store failed (docs/ARCHITECTURE.md §4 "Account store"): no response or
 * a gateway status (`network`); the session is no longer the store's user, or the token was
 * refused (`signed-out`); the database refused the request (`rejected`, a bug or a schema drift); a
 * row this version cannot read (`invalid-row`); anything else (`unknown`).
 */
export const LIBRARY_REMOTE_REASONS = [
  'network',
  'signed-out',
  'rejected',
  'invalid-row',
  'unknown',
] as const;

export type LibraryRemoteReason = (typeof LIBRARY_REMOTE_REASONS)[number];

const LIBRARY_REMOTE_MESSAGES: Readonly<Record<LibraryRemoteReason, string>> = {
  network: 'Account library unreachable',
  'signed-out': 'Account library session ended',
  rejected: 'Account library request rejected',
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
