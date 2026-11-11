import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedFile, seedSecureItem } from './__fixtures__/app-storage-device';
import {
  CACHE_KEY,
  CACHE_VALUE,
  captureError,
  launch,
  LIBRARY_KEY,
  LIBRARY_VALUE,
  NEWER_THEME_VALUE,
  OTHER_KEY,
  resetLaunch,
  seedEncrypted,
  STORED_KEY,
  THEME_KEY,
  THEME_VALUE,
} from './__fixtures__/app-storage-launch';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import {
  APP_STORAGE_INSTANCE_ID,
  KEY_CHECK_KEY,
  KEY_CHECK_VALUE,
  MIGRATED_MARKER_KEY,
  MIGRATED_MARKER_VALUE,
} from './app-storage-instance';
import { APP_STORAGE_KEY_NAME } from './app-storage-key';
import { STORAGE_INSTANCE_ID } from './storage';

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

// what an unencrypted instance of the previous version holds
const LEGACY_VALUES = {
  [THEME_KEY]: THEME_VALUE,
  [LIBRARY_KEY]: LIBRARY_VALUE,
  [CACHE_KEY]: CACHE_VALUE,
};
const MIGRATED = {
  [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
  ...LEGACY_VALUES,
  [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
};

const seedLegacy = (values: Readonly<Record<string, string | number>> = LEGACY_VALUES) => {
  seedFile(STORAGE_INSTANCE_ID, undefined, values);
};

const legacySets = () =>
  device.events.filter((event) => event.startsWith(`mmkv.set:${APP_STORAGE_INSTANCE_ID}:`));

// a launch, then the events it caused
const launchEvents = () => {
  const start = device.events.length;
  launch();
  return device.events.slice(start);
};

beforeEach(resetLaunch);

describe('openAppStorage, the unencrypted instance of a previous version', () => {
  it('copies every value, then writes the marker, keeping the unencrypted instance it opened', () => {
    seedLegacy();

    const storage = launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(device.events.at(-1)).toBe(`mmkv.set:${APP_STORAGE_INSTANCE_ID}:${MIGRATED_MARKER_KEY}`);
    expect(device.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('deletes it at the next launch without opening it', () => {
    seedLegacy();
    launch();

    const events = launchEvents();

    expect(events).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('copies string values only and never its own reserved keys', () => {
    seedLegacy({ ...LEGACY_VALUES, 'legacy.count': 3, [KEY_CHECK_KEY]: 'a-forged-check' });

    launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
  });

  it('leaves nothing to copy or delete without an unencrypted instance', () => {
    launch();

    expect(device.events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(device.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
  });
});

describe('openAppStorage, a copy that fails', () => {
  it('keeps the unencrypted instance as the storage of this process, reported', () => {
    seedLegacy();
    // the key check and one value land, then the copy fails
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 2 };

    const storage = launch();
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual({
      ...LEGACY_VALUES,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[MIGRATED_MARKER_KEY]).toBeUndefined();
    expect(device.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);
  });

  it('completes at the next launch with no loss, the newer values overwriting the partial copy', () => {
    seedLegacy();
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 2 };
    launch().set(THEME_KEY, NEWER_THEME_VALUE);
    device.failures.setLimit = undefined;
    captureError.mockClear();

    const storage = launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...MIGRATED,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(storage.getString(THEME_KEY)).toBe(NEWER_THEME_VALUE);
    expect(launchEvents()).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('runs on memory when the unencrypted instance cannot be opened, deleting nothing', () => {
    seedLegacy();
    device.failures.create.add(STORAGE_INSTANCE_ID);

    const storage = launch();

    expect(storage.getString(LIBRARY_KEY)).toBeUndefined();
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({ [KEY_CHECK_KEY]: KEY_CHECK_VALUE });
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);
  });
});

describe('openAppStorage, a copy marked done', () => {
  it('never copies again after a kill before the deletion: the newer encrypted value stays', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(STORED_KEY, {
      ...LEGACY_VALUES,
      [THEME_KEY]: NEWER_THEME_VALUE,
      [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
    });
    seedLegacy();

    const storage = launch();

    expect(storage.getString(THEME_KEY)).toBe(NEWER_THEME_VALUE);
    expect(device.events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(legacySets()).toStrictEqual([]);
    expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it.each(['throw', 'false'] as const)(
    'reports a failed deletion (%s), uses the encrypted copy and retries at the next launch',
    (failure) => {
      seedLegacy();
      launch();
      device.failures.delete.set(STORAGE_INSTANCE_ID, failure);

      const storage = launch();
      storage.set(THEME_KEY, NEWER_THEME_VALUE);

      expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(NEWER_THEME_VALUE);
      expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
      expect(reportedProblems(captureError)).toStrictEqual(['legacy-delete-failed']);

      device.failures.delete.clear();
      captureError.mockClear();
      launch();

      expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
      expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(NEWER_THEME_VALUE);
      expect(reportedProblems(captureError)).toStrictEqual([]);
    },
  );
});

describe('openAppStorage, a key lost while the unencrypted instance remains', () => {
  it('copies the unencrypted instance again into the new instance: nothing of it is lost', () => {
    seedEncrypted(OTHER_KEY, { ...LEGACY_VALUES, [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE });
    seedLegacy();

    const storage = launch();

    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost']);
  });

  it('copies it again after a key mismatch', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(OTHER_KEY, { [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE });
    seedLegacy();

    launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(reportedProblems(captureError)).toStrictEqual(['key-mismatch']);
  });

  it('keeps it when the key cannot be stored', () => {
    device.failures.secureWrite = true;
    seedLegacy();

    launch();

    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
    expect(reportedProblems(captureError)).toStrictEqual(['key-unavailable']);
  });
});
