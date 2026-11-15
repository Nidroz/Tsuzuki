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
import { migrateLegacyStorage, STORAGE_INSTANCE_ID } from './app-storage-migration';
import { createMemoryStorage } from './memory-storage';

export interface AppStorageOptions {
  readonly reporter: ErrorReporter;
  /** a cryptographically secure source (web crypto `getRandomValues`), used for a new key only */
  readonly getRandomValues: GetRandomValues;
}

/** the app storage of this process, and what the composition root needs to know about it. */
export interface AppStorage {
  /** the encrypted instance, the unencrypted one while its copy is not complete, or memory */
  readonly storage: StorageAdapter;
  /**
   * false exactly when this process runs on memory (key-unavailable, open-failed, an unencrypted
   * instance that cannot be opened): what it writes is gone when it ends, a purge included
   */
  readonly persistent: boolean;
  /**
   * neither the encrypted nor the unencrypted instance existed as the call started: a new install,
   * or a reinstall. the ios keychain outlives an uninstall, so what the secure store holds then
   * (the app storage key, the session) was written before it: the key is never used, and the
   * stored session is the caller's to discard
   */
  readonly firstLaunch: boolean;
}

// whether no app storage file exists, or undefined when mmkv cannot tell
const findFirstLaunch = (): boolean | undefined => {
  try {
    return !existsMMKV(APP_STORAGE_INSTANCE_ID) && !existsMMKV(STORAGE_INSTANCE_ID);
  } catch {
    // the caught error is dropped: the caller reports open-failed
    return undefined;
  }
};

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
// without its key stored. written over any stored key. undefined when it cannot be generated or
// stored
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

// the key of the encrypted instance, or undefined when this process runs on memory. a first
// launch never reads the stored key: with no file, a key found is stale (written before a
// reinstall), and a new one is written over it
const resolveKey = (
  firstLaunch: boolean,
  getRandomValues: GetRandomValues,
  report: ReportAppStorageProblem,
): string | undefined => {
  if (firstLaunch) return createKey(getRandomValues, report);
  const stored = readStoredKey(report);
  if (stored === undefined) return undefined;
  if (stored.status === 'valid') return stored.key;
  discardUnreadableInstance(stored.status, report);
  return createKey(getRandomValues, report);
};

// the encrypted instance, or undefined when this process runs on memory
const openWithKey = (
  firstLaunch: boolean,
  getRandomValues: GetRandomValues,
  report: ReportAppStorageProblem,
): MMKV | undefined => {
  try {
    const key = resolveKey(firstLaunch, getRandomValues, report);
    return key === undefined ? undefined : openEncryptedInstance(key, report);
  } catch {
    // the caught error is dropped, not reported: it could quote the key or a stored value
    report('open-failed');
    return undefined;
  }
};

const onMemory = (firstLaunch: boolean): AppStorage => ({
  storage: createMemoryStorage(),
  persistent: false,
  firstLaunch,
});

/**
 * the app storage: one mmkv instance encrypted with aes-256 (ADR-0020), for everything the app
 * stores, preferences included. call it once per process, before anything reads the storage.
 *
 * the key is read synchronously from the secure store (WHEN_UNLOCKED_THIS_DEVICE_ONLY, like the
 * session) and kept in memory for the process: writes also happen when the app goes to the
 * background, possibly while the device locks. a first launch (no app storage file) never reads
 * it: a new key is written over any stored one. a missing or invalid key while the encrypted files
 * exist means the key is lost (a backup restored on another device, a keychain reset): those files
 * are deleted and a new key is stored before a new instance is created; everything they held is
 * lost (the guest library, the account device copies and their unsynced writes, the purge markers,
 * the recent searches, the persisted cache, the preferences), never the unencrypted instance of an
 * older version, which is deleted only after a complete copy (app-storage-migration.ts). a secure
 * store that cannot be read or written, or an instance that cannot be opened, leaves this process
 * on memory (persistent false) with every file untouched, until the next launch. every problem is
 * reported as an AppStorageError with the app storage source, never with the caught error or a key.
 *
 * mmkv that cannot tell whether the files exist is not trusted to open them: memory, open-failed,
 * the key and every file untouched. firstLaunch is then false, the conservative value: true would
 * write a new key over the one that may open existing files (losing them) and discard a session on
 * a guess, while false at worst keeps a stale session and key for one more launch.
 *
 * backups are not excluded: the encrypted files are useless without the key, which never leaves
 * the device; excluding them needs native config and a new build
 */
export const openAppStorage = ({ reporter, getRandomValues }: AppStorageOptions): AppStorage => {
  const report = (problem: AppStorageProblem): void => {
    reporter.captureError(new AppStorageError(problem), { source: APP_STORAGE_REPORT_SOURCE });
  };
  const firstLaunch = findFirstLaunch();
  if (firstLaunch === undefined) {
    report('open-failed');
    return onMemory(false);
  }
  const encrypted = openWithKey(firstLaunch, getRandomValues, report);
  if (encrypted === undefined) return onMemory(firstLaunch);
  const storage = migrateLegacyStorage(encrypted, report);
  return storage === undefined ? onMemory(firstLaunch) : { storage, persistent: true, firstLaunch };
};
