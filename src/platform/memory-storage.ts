import type { StorageAdapter } from '@core/repositories/storage-adapter';

/**
 * a StorageAdapter in memory, the app storage of a process that cannot open its files: the app
 * works, and what it writes lasts until the process ends
 */
export const createMemoryStorage = (): StorageAdapter => {
  const values = new Map<string, string>();
  return {
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
};
