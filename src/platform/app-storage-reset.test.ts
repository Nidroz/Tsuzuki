import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedSecureItem } from './__fixtures__/app-storage-device';
import {
  captureError,
  launch,
  NEW_KEY,
  OTHER_KEY,
  resetLaunch,
  seedEncrypted,
  STORED_KEY,
  THEME_KEY,
  THEME_VALUE,
} from './__fixtures__/app-storage-launch';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import { APP_STORAGE_INSTANCE_ID, KEY_CHECK_KEY, KEY_CHECK_VALUE } from './app-storage-instance';
import { APP_STORAGE_KEY_NAME } from './app-storage-key';
import { STORAGE_INSTANCE_ID } from './storage';

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

const INVALID_KEY = 'short-stored-key';

beforeEach(resetLaunch);

describe('openAppStorage, a lost key', () => {
  it('resets the encrypted instance when the key is gone, reported, without throwing', () => {
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });

    const storage = launch();

    expect(storage.getString(THEME_KEY)).toBeUndefined();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({ [KEY_CHECK_KEY]: KEY_CHECK_VALUE });
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost']);
  });

  it('deletes the old files, then stores the new key, then creates the instance', () => {
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });

    launch();

    expect(device.events).toStrictEqual([
      'secure.get',
      `mmkv.exists:${APP_STORAGE_INSTANCE_ID}`,
      `mmkv.delete:${APP_STORAGE_INSTANCE_ID}`,
      'secure.set',
      `mmkv.exists:${APP_STORAGE_INSTANCE_ID}`,
      `mmkv.create:${APP_STORAGE_INSTANCE_ID}`,
      `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${KEY_CHECK_KEY}`,
      `mmkv.exists:${STORAGE_INSTANCE_ID}`,
    ]);
  });

  it('lets the key check clear files a failed deletion left', () => {
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });
    device.failures.delete.set(APP_STORAGE_INSTANCE_ID, 'throw');

    const storage = launch();

    expect(storage.getString(THEME_KEY)).toBeUndefined();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({ [KEY_CHECK_KEY]: KEY_CHECK_VALUE });
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost', 'key-mismatch']);
  });

  it('leaves a launch killed after the deletion or after the key write to the next one', () => {
    // killed after the deletion: no key and no file, a first launch
    expect(device.files.size).toBe(0);
    launch();
    expect(reportedProblems(captureError)).toStrictEqual([]);

    // killed after the key write: a key and no file, a new instance
    resetLaunch();
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    launch();
    expect(device.configurations[0]?.encryptionKey).toBe(STORED_KEY);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});

describe('openAppStorage, an invalid key', () => {
  it.each([
    ['too short', INVALID_KEY],
    ['too long', `${STORED_KEY}-and-more`],
    ['with a character out of the alphabet', `${STORED_KEY.slice(1)}.`],
  ])('replaces a stored key %s and resets its instance', (_, invalid) => {
    seedSecureItem(APP_STORAGE_KEY_NAME, invalid);
    seedEncrypted(invalid, { [THEME_KEY]: THEME_VALUE });

    const storage = launch();

    expect(storage.getString(THEME_KEY)).toBeUndefined();
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(device.configurations[0]?.encryptionKey).toBe(NEW_KEY);
    expect(reportedProblems(captureError)).toStrictEqual(['key-invalid']);
  });

  it('replaces an invalid key with no instance, reported, deleting nothing', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, INVALID_KEY);

    launch();

    expect(device.events).not.toContain(`mmkv.delete:${APP_STORAGE_INSTANCE_ID}`);
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(reportedProblems(captureError)).toStrictEqual(['key-invalid']);
  });
});
