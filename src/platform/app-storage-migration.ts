import type { StorageAdapter } from '@core/repositories/storage-adapter';
import { createMMKV, deleteMMKV, existsMMKV, type MMKV } from 'react-native-mmkv';

import {
  isReservedKey,
  LEGACY_COPIED_MARKER_KEY,
  MIGRATED_MARKER_KEY,
  MIGRATED_MARKER_VALUE,
  mmkvStorageAdapter,
  type ReportAppStorageProblem,
} from './app-storage-instance';
import { createMemoryStorage } from './memory-storage';
import { STORAGE_INSTANCE_ID } from './storage';

// before the marker nothing but this copy writes the encrypted instance: what it holds besides its
// reserved keys is a copy interrupted earlier, holding keys the unencrypted instance may have lost
// since (a sign out purge, the guest merge cleanup). they are removed first, so the copy is
// exactly every string value of the unencrypted instance, reserved keys excepted, overwriting
const copyLegacyValues = (legacy: MMKV, encrypted: MMKV): void => {
  for (const key of encrypted.getAllKeys()) {
    if (!isReservedKey(key)) encrypted.remove(key);
  }
  for (const key of legacy.getAllKeys()) {
    const value = legacy.getString(key);
    if (value !== undefined && !isReservedKey(key)) encrypted.set(key, value);
  }
};

// a failed deletion leaves the unencrypted instance for the next launch, which only deletes it
const deleteLegacyInstance = (report: ReportAppStorageProblem): void => {
  let deleted: boolean;
  try {
    deleted = deleteMMKV(STORAGE_INSTANCE_ID);
  } catch {
    // the caught error is dropped, not reported: it could quote a stored key or value
    deleted = false;
  }
  if (!deleted) report('legacy-delete-failed');
};

/**
 * the one-time migration of the unencrypted instance (storage.ts) into the encrypted one, then the
 * app storage of this process. without the encrypted marker, the unencrypted instance is opened:
 * unless it holds its own copied marker, the encrypted instance is emptied of everything but its
 * reserved keys and every string value is copied; then the encrypted marker is written, then the
 * copied marker into the unencrypted instance. one already marked copied (the encrypted instance
 * was reset since by a lost or mismatched key) is stale: nothing is copied, only the encrypted
 * marker is written. with the encrypted marker, nothing is copied again (the encrypted copy may be
 * newer) and the unencrypted instance is deleted without being opened: only after a complete copy
 * marked done, so its data is never lost.
 *
 * a step that throws is reported (migration-failed) and leaves this process on the unencrypted
 * instance while the copy is not marked done (the next launch copies it again, its newer content
 * replacing the partial copy), on the encrypted instance once it is marked done or when the
 * unencrypted instance was copied before, and on memory when the unencrypted instance cannot be
 * opened or read
 */
export const migrateLegacyStorage = (
  encrypted: MMKV,
  report: ReportAppStorageProblem,
): StorageAdapter => {
  const storage = mmkvStorageAdapter(encrypted);
  // the storage of this process when a step throws, moved on as the steps succeed; memory until
  // the unencrypted instance is read: writing the encrypted instance before the copy would let
  // the next copy remove those writes
  let fallback: StorageAdapter | undefined;
  let openedLegacy = false;
  try {
    if (!existsMMKV(STORAGE_INSTANCE_ID)) return storage;
    if (encrypted.getString(MIGRATED_MARKER_KEY) !== MIGRATED_MARKER_VALUE) {
      openedLegacy = true;
      const legacy = createMMKV({ id: STORAGE_INSTANCE_ID });
      const copiedBefore = legacy.getString(LEGACY_COPIED_MARKER_KEY) === MIGRATED_MARKER_VALUE;
      fallback = copiedBefore ? storage : mmkvStorageAdapter(legacy);
      if (!copiedBefore) copyLegacyValues(legacy, encrypted);
      encrypted.set(MIGRATED_MARKER_KEY, MIGRATED_MARKER_VALUE);
      // marked done: a kill or a failure from here on leaves the encrypted marker alone, which
      // deletes the unencrypted instance at the next launch all the same
      fallback = storage;
      if (!copiedBefore) legacy.set(LEGACY_COPIED_MARKER_KEY, MIGRATED_MARKER_VALUE);
    }
  } catch {
    // the caught error is dropped, not reported: it could quote a stored key or value
    report('migration-failed');
    return fallback ?? createMemoryStorage();
  }
  // an instance opened in this process is never deleted in it: mmkv destroys an open instance on
  // deletion, while react-native-mmkv keeps calling it (its app state listeners trim every created
  // instance). the launch that opened it keeps the file; the next one finds the encrypted marker
  // and deletes it without opening it, so the plaintext stays on disk until that launch
  if (!openedLegacy) deleteLegacyInstance(report);
  return storage;
};
