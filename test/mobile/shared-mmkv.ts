import { jest } from '@jest/globals';
import type * as Mmkv from 'react-native-mmkv';

// the id react-native-mmkv uses when none is given
const DEFAULT_INSTANCE_ID = 'mmkv.default';

/**
 * a react-native-mmkv module whose createMMKV returns one in-memory instance per id, like the
 * device does. the real module returns a new empty instance on every call under jest, so a test
 * could neither seed nor read the storage the app opened. use it from a jest.mock factory:
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
  };
};
