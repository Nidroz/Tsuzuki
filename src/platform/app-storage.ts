import {
  APP_STORAGE_REPORT_SOURCE,
  AppStorageError,
  type AppStorageProblem,
} from '@core/errors/app-storage-errors';
import type { ErrorReporter } from '@core/errors/error-reporter';
import type { StorageAdapter } from '@core/repositories/storage-adapter';
import { deleteMMKV, existsMMKV, type MMKV } from 'react-native-mmkv';

import {
  generateAppStorageKey,
  type GetRandomValues,
  readAppStorageKey,
  type StoredAppStorageKey,
  writeAppStorageKey,
} from './app-storage-key';
import {
  APP_STORAGE_INSTANCE_ID,
  openEncryptedInstance,
  type ReportAppStorageProblem,
} from './app-storage-instance';
import { migrateLegacyStorage } from './app-storage-migration';
import { createMemoryStorage } from './memory-storage';

export interface AppStorageOptions {
  readonly reporter: ErrorReporter;
  /** a cryptographically secure source (web crypto `getRandomValues`), used for a new key only */
  readonly getRandomValues: GetRandomValues;
}

// the stored key, or undefined when the secure store cannot be read: the caller then opens no file
const readStoredKey = (report: ReportAppStorageProblem): StoredAppStorageKey | undefined => {
  try {
    return readAppStorageKey();
  } catch {
    // the caught error is dropped, not reported: it could quote the stored key
    report('key-unavailable');
    return undefined;
  }
};

// no usable key: encrypted files written with the lost key can never be read again, so they are
// deleted before a new key exists. a failed deletion is left to the key check of the open, which
// clears what is left and reports key-mismatch
const discardUnreadableInstance = (
  status: 'missing' | 'invalid',
  report: ReportAppStorageProblem,
): void => {
  const existed = existsMMKV(APP_STORAGE_INSTANCE_ID);
  if (existed) {
    try {
      deleteMMKV(APP_STORAGE_INSTANCE_ID);
    } catch {
      // dropped, not reported: the key check reports what this deletion left
    }
  }
  if (status === 'invalid') report('key-invalid');
  else if (existed) report('key-lost');
};

// a new key, stored before the encrypted instance is created: an encrypted file never exists
// without its key stored. undefined when it cannot be generated or stored
const createKey = (
  getRandomValues: GetRandomValues,
  report: ReportAppStorageProblem,
): string | undefined => {
  try {
    const key = generateAppStorageKey(getRandomValues);
    writeAppStorageKey(key);
    return key;
  } catch {
    // the caught error is dropped, not reported: it could quote the new key
    report('key-unavailable');
    return undefined;
  }
};

// the encrypted instance, or undefined when this process runs on memory
const openWithKey = (
  stored: StoredAppStorageKey,
  getRandomValues: GetRandomValues,
  report: ReportAppStorageProblem,
): MMKV | undefined => {
  let key: string | undefined;
  if (stored.status === 'valid') {
    key = stored.key;
  } else {
    discardUnreadableInstance(stored.status, report);
    key = createKey(getRandomValues, report);
  }
  return key === undefined ? undefined : openEncryptedInstance(key, report);
};

/**
 * the app storage: one mmkv instance encrypted with aes-256 (ADR-0020), for everything the app
 * stores, preferences included. call it once per process, before anything reads the storage.
 *
 * the key is read synchronously from the secure store (WHEN_UNLOCKED_THIS_DEVICE_ONLY, like the
 * session) and kept in memory for the process: writes also happen when the app goes to the
 * background, possibly while the device locks. a missing or invalid key while the encrypted files
 * exist means the key is lost (a backup restored on another device, a keychain reset): those files
 * are deleted and a new key is stored before a new instance is created; everything they held is
 * lost (the guest library, the account device copies and their unsynced writes, the purge markers,
 * the recent searches, the persisted cache, the preferences), never the unencrypted instance of an
 * older version, which is deleted only after a complete copy (app-storage-migration.ts). a secure
 * store that cannot be read or written, or an instance that cannot be opened, leaves this process
 * on memory with every file untouched, until the next launch. every problem is reported as an
 * AppStorageError with the app storage source, never with the caught error or a key.
 *
 * backups are not excluded: the encrypted files are useless without the key, which never leaves
 * the device; excluding them needs native config and a new build
 */
export const openAppStorage = ({
  reporter,
  getRandomValues,
}: AppStorageOptions): StorageAdapter => {
  const report = (problem: AppStorageProblem): void => {
    reporter.captureError(new AppStorageError(problem), { source: APP_STORAGE_REPORT_SOURCE });
  };
  const stored = readStoredKey(report);
  if (stored === undefined) return createMemoryStorage();
  let encrypted: MMKV | undefined;
  try {
    encrypted = openWithKey(stored, getRandomValues, report);
  } catch {
    // the caught error is dropped, not reported: it could quote the key or a stored value
    report('open-failed');
    return createMemoryStorage();
  }
  return encrypted === undefined ? createMemoryStorage() : migrateLegacyStorage(encrypted, report);
};
