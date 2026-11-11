import type { AppStorageProblem } from '@core/errors/app-storage-errors';
import type { StorageAdapter } from '@core/repositories/storage-adapter';
import { createMMKV, existsMMKV, type MMKV } from 'react-native-mmkv';

/** reports one app storage problem, never a caught error or a value. */
export type ReportAppStorageProblem = (problem: AppStorageProblem) => void;

/** the id of the encrypted mmkv instance that holds the whole app storage. */
export const APP_STORAGE_INSTANCE_ID = 'tsuzuki-encrypted';

// the keys this module reserves in the encrypted instance. no StorageAdapter consumer writes under
// the prefix (preferences.*, recent-searches, guest-library, query-cache, device-purge-pending,
// account-library-copy.*, account-library-queue.*), and the copy of the unencrypted instance skips it
export const RESERVED_KEY_PREFIX = 'app-storage.';

// written right after a new instance is created, before anything else: an existing instance that
// does not read it back was opened with a key other than the one that wrote it
export const KEY_CHECK_KEY = `${RESERVED_KEY_PREFIX}check`;
export const KEY_CHECK_VALUE = 'tsuzuki-app-storage-check';

// written once every value of the unencrypted instance is copied into the encrypted one
export const MIGRATED_MARKER_KEY = `${RESERVED_KEY_PREFIX}migrated`;
export const MIGRATED_MARKER_VALUE = 'copied';

export const isReservedKey = (key: string): boolean => key.startsWith(RESERVED_KEY_PREFIX);

/** the StorageAdapter over one mmkv instance. */
export const mmkvStorageAdapter = (mmkv: MMKV): StorageAdapter => ({
  getString: (key) => mmkv.getString(key),
  set: (key, value) => {
    mmkv.set(key, value);
  },
  delete: (key) => {
    mmkv.remove(key);
  },
});

/**
 * opens the encrypted instance with the key (aes-256), then checks the key: a new instance gets
 * the check value first; an existing one that does not read it back is cleared, gets the check
 * value and the mismatch is reported (its content cannot be read with this key). throws when the
 * instance cannot be opened or written
 */
export const openEncryptedInstance = (key: string, report: ReportAppStorageProblem): MMKV => {
  const existed = existsMMKV(APP_STORAGE_INSTANCE_ID);
  const mmkv = createMMKV({
    id: APP_STORAGE_INSTANCE_ID,
    encryptionKey: key,
    encryptionType: 'AES-256',
  });
  if (!existed) {
    mmkv.set(KEY_CHECK_KEY, KEY_CHECK_VALUE);
  } else if (mmkv.getString(KEY_CHECK_KEY) !== KEY_CHECK_VALUE) {
    mmkv.clearAll();
    mmkv.set(KEY_CHECK_KEY, KEY_CHECK_VALUE);
    report('key-mismatch');
  }
  return mmkv;
};
