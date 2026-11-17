import { jest } from '@jest/globals';
import type * as Mmkv from 'react-native-mmkv';

// the id react-native-mmkv uses when none is given
const DEFAULT_INSTANCE_ID = 'mmkv.default';

/**
 * a react-native-mmkv module whose createMMKV returns one in-memory instance per id, like the
 * device does, whatever the encryption options (the instance stores plain values). the real module
 * returns a new empty instance on every call under jest, and says every file exists, so a test
 * could neither seed nor read the storage the app opened, and the app storage (openAppStorage)
 * would take every launch for one whose key was lost.
 *
 * here a file exists once its instance holds a value: an instance a test helper opened before the
 * app, to seed it later, is no file yet, so the first load of the root layout is a first launch
 * (a new key, the encrypted instance created). deleteMMKV empties the instance, which stays usable:
 * the references a test holds stay valid. use it from a jest.mock factory, with the secure store
 * and the random source of app-device.ts:
 * `jest.mock('react-native-mmkv', () => jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule())`
 */
export const sharedMmkvModule = (): typeof Mmkv => {
  const actual = jest.requireActual<typeof Mmkv>('react-native-mmkv');
  const instances = new Map<string, Mmkv.MMKV>();
  return {
    ...actual,
    createMMKV: (configuration) => {
      const id = configuration?.id ?? DEFAULT_INSTANCE_ID;
      const existing = instances.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const created = actual.createMMKV(configuration);
      instances.set(id, created);
      return created;
    },
    existsMMKV: (id) => (instances.get(id)?.getAllKeys().length ?? 0) > 0,
    deleteMMKV: (id) => {
      instances.get(id)?.clearAll();
      return true;
    },
  };
};
