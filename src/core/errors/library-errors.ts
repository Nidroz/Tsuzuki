// errors of the library repositories (docs/ARCHITECTURE.md §4). entries hold personal data (notes,
// titles): messages and fields never hold stored content, a title, notes or a media key, and no
// cause is attached, since these errors reach the error reporter

/**
 * why the guest store could not be read whole: the stored text is not json, the json is not a
 * version 1 envelope, some entries failed the entry schema and were dropped, or several entries
 * had the same key and only the most recent was kept.
 */
export const LIBRARY_STORAGE_ERROR_REASONS = [
  'invalid-json',
  'invalid-envelope',
  'invalid-entries',
  'duplicate-keys',
] as const;

export type LibraryStorageReason = (typeof LIBRARY_STORAGE_ERROR_REASONS)[number];

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
