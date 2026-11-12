import type { AppStorageProblem } from '@core/errors/app-storage-errors';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedSecureItem } from './__fixtures__/app-storage-device';
import {
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
import {
  COPIED_LEGACY,
  launchWithEvents,
  LEGACY_VALUES,
  MARKED_ONLY,
  MIGRATED,
  seedLegacy,
} from './__fixtures__/app-storage-legacy';
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

// how the key of a complete copy goes before the next launch deletes the unencrypted instance
const KEY_RESETS: readonly [string, AppStorageProblem, () => void][] = [
  [
    'lost',
    'key-lost',
    () => {
      device.secureItems.delete(APP_STORAGE_KEY_NAME);
    },
  ],
  [
    'mismatched',
    'key-mismatch',
    () => {
      seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    },
  ],
];

// a complete copy, then the guest merge cleanup of the guest library in the encrypted instance
const copyThenCleanUp = (): void => {
  seedLegacy();
  launch().delete(LIBRARY_KEY);
};

beforeEach(resetLaunch);

describe('openAppStorage, a key reset while the copy never completed', () => {
  it.each([
    ['partial', { [THEME_KEY]: THEME_VALUE }],
    // killed between the two markers: the unencrypted instance was never marked copied
    [
      'complete, its instance never marked copied',
      { ...LEGACY_VALUES, [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE },
    ],
  ])('copies the unencrypted instance again after a lost key (copy %s)', (_, encrypted) => {
    seedEncrypted(OTHER_KEY, encrypted);
    seedLegacy();

    const storage = launch();

    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost']);
  });

  it('copies it again after a key mismatch', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });
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

describe('openAppStorage, a key reset after a complete copy', () => {
  it.each(KEY_RESETS)(
    'copies nothing of the unencrypted instance again (key %s), deleted at the following launch',
    (_, problem, resetKey) => {
      copyThenCleanUp();
      resetKey();
      captureError.mockClear();

      const reset = launchWithEvents();

      expect(reset.storage.getString(LIBRARY_KEY)).toBeUndefined();
      expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MARKED_ONLY);
      // opened by this launch, so kept by it
      expect(reset.events).toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
      expect(reset.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
      expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
      expect(reportedProblems(captureError)).toStrictEqual([problem]);

      captureError.mockClear();
      const following = launchWithEvents();

      expect(following.events).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
      expect(following.events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
      expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
      expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MARKED_ONLY);
      expect(reportedProblems(captureError)).toStrictEqual([]);
    },
  );

  it('runs on the encrypted instance, not the stale one, when its marker write fails', () => {
    copyThenCleanUp();
    device.secureItems.delete(APP_STORAGE_KEY_NAME);
    // the key check of the new instance lands, then its marker fails
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 1 };
    captureError.mockClear();

    const storage = launch();
    device.failures.setLimit = undefined;
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect(storage.getString(LIBRARY_KEY)).toBeUndefined();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost', 'migration-failed']);

    // the next launch marks it without copying, keeping what that process wrote
    captureError.mockClear();
    launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...MARKED_ONLY,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});
