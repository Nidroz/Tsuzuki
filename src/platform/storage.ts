import type { StorageAdapter } from '@core/repositories/storage-adapter';
import { createMMKV } from 'react-native-mmkv';

// one unencrypted instance for the app: it never holds secrets (the session is in secure-store)
export const STORAGE_INSTANCE_ID = 'tsuzuki';

/** the app's synchronous key-value storage, over MMKV */
export const createStorage = (): StorageAdapter => {
  const mmkv = createMMKV({ id: STORAGE_INSTANCE_ID });
  return {
    getString: (key) => mmkv.getString(key),
    set: (key, value) => {
      mmkv.set(key, value);
    },
    delete: (key) => {
      mmkv.remove(key);
    },
  };
};
