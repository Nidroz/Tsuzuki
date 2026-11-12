// errors of the encrypted app storage (ADR-0020): its key in the secure store, the one-time
// migration of the unencrypted instance, a key lost while the encrypted files survive. each is
// reported with a fixed message per problem and no cause, since a storage or keychain error could
// quote a key or stored content

/** the report source of the app storage problems. */
export const APP_STORAGE_REPORT_SOURCE = 'app-storage';

/**
 * what went wrong: the key could not be read or written (`key-unavailable`: the app runs on a
 * memory storage for this process, the files untouched); the encrypted instance could not be
 * opened (`open-failed`, the same memory storage); a stored key of the wrong form
 * (`key-invalid`), no key while the encrypted files exist (`key-lost`) or a key that does not open
 * them (`key-mismatch`), each followed by a reset; the copy of the unencrypted instance failed
 * (`migration-failed`, retried at the next launch); the unencrypted instance could not be deleted
 * after its copy (`legacy-delete-failed`, retried at the next launch).
 */
export const APP_STORAGE_PROBLEMS = [
  'key-unavailable',
  'open-failed',
  'key-invalid',
  'key-lost',
  'key-mismatch',
  'migration-failed',
  'legacy-delete-failed',
] as const;

export type AppStorageProblem = (typeof APP_STORAGE_PROBLEMS)[number];

const APP_STORAGE_MESSAGES: Readonly<Record<AppStorageProblem, string>> = {
  'key-unavailable': 'App storage key unavailable',
  'open-failed': 'App storage could not be opened',
  'key-invalid': 'App storage key invalid: storage reset',
  'key-lost': 'App storage key lost: storage reset',
  'key-mismatch': 'App storage key mismatch: storage reset',
  'migration-failed': 'App storage migration failed',
  'legacy-delete-failed': 'App storage legacy instance not deleted',
};

/** an app storage problem; it holds the problem only. */
export class AppStorageError extends Error {
  readonly problem: AppStorageProblem;

  constructor(problem: AppStorageProblem) {
    super(APP_STORAGE_MESSAGES[problem]);
    this.name = 'AppStorageError';
    this.problem = problem;
  }
}
