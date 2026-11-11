import type { StorageAdapter } from '@core/repositories/storage-adapter';
import { createMMKV, deleteMMKV, existsMMKV, type MMKV } from 'react-native-mmkv';

import {
  isReservedKey,
  MIGRATED_MARKER_KEY,
  MIGRATED_MARKER_VALUE,
  mmkvStorageAdapter,
  type ReportAppStorageProblem,
} from './app-storage-instance';
import { createMemoryStorage } from './memory-storage';
import { STORAGE_INSTANCE_ID } from './storage';

// every string value of the unencrypted instance, overwriting: before the marker nothing but this
// copy writes the encrypted instance, so a copy interrupted by a kill is simply done again
const copyLegacyValues = (legacy: MMKV, encrypted: MMKV): void => {
  for (const key of legacy.getAllKeys()) {
    const value = legacy.getString(key);
    if (value !== undefined && !isReservedKey(key)) encrypted.set(key, value);
  }
  encrypted.set(MIGRATED_MARKER_KEY, MIGRATED_MARKER_VALUE);
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
 * app storage of this process. without the marker, every string value is copied, then the marker
 * is written; with it, nothing is copied again (the encrypted copy may be newer). the unencrypted
 * instance is deleted by the first launch that finds the marker without having opened it: only
 * after a complete copy marked done, so its data is never lost. a copy that throws is reported and the unencrypted instance stays the storage of this
 * process, as before this change: the next launch copies it again, its newer content overwriting
 * the partial copy
 */
export const migrateLegacyStorage = (
  encrypted: MMKV,
  report: ReportAppStorageProblem,
): StorageAdapter => {
  let legacy: MMKV | undefined;
  try {
    if (!existsMMKV(STORAGE_INSTANCE_ID)) return mmkvStorageAdapter(encrypted);
    if (encrypted.getString(MIGRATED_MARKER_KEY) !== MIGRATED_MARKER_VALUE) {
      legacy = createMMKV({ id: STORAGE_INSTANCE_ID });
      copyLegacyValues(legacy, encrypted);
    }
  } catch {
    // the caught error is dropped, not reported: it could quote a stored key or value
    report('migration-failed');
    // an unencrypted instance that cannot be opened leaves this process on memory: writing the
    // encrypted instance before the copy would let the next copy overwrite those writes
    return legacy === undefined ? createMemoryStorage() : mmkvStorageAdapter(legacy);
  }
  // an instance opened in this process is never deleted in it: mmkv destroys an open instance on
  // deletion, while react-native-mmkv keeps calling it (its app state listeners trim every created
  // instance). the launch that copied keeps the file; the next one finds the marker and deletes it
  // without opening it, so the plaintext stays on disk until that launch
  if (legacy === undefined) deleteLegacyInstance(report);
  return mmkvStorageAdapter(encrypted);
};
