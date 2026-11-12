import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedFile, seedSecureItem } from './__fixtures__/app-storage-device';
import {
  captureError,
  fileEvents,
  getRandomValues,
  launch,
  LIBRARY_KEY,
  LIBRARY_VALUE,
  NEW_KEY,
  NEWER_THEME_VALUE,
  OTHER_KEY,
  resetLaunch,
  seedEncrypted,
  STORED_KEY,
  THEME_KEY,
  THEME_VALUE,
} from './__fixtures__/app-storage-launch';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import { APP_STORAGE_INSTANCE_ID } from './app-storage-instance';
import {
  APP_STORAGE_KEY_LENGTH,
  APP_STORAGE_KEY_NAME,
  type GetRandomValues,
} from './app-storage-key';
import { STORAGE_INSTANCE_ID } from './storage';

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

// random sources a key cannot come from: the key generation throws, whatever the reason
const BROKEN_SOURCES: readonly [string, GetRandomValues][] = [
  [
    'throws',
    () => {
      throw new Error('no entropy');
    },
  ],
  ['returns another array', () => new Uint8Array(APP_STORAGE_KEY_LENGTH).fill(1)],
  ['returns an empty array', () => new Uint8Array(0)],
  ['fills nothing', (array) => array],
];

beforeEach(resetLaunch);

describe('openAppStorage, a secure store that fails', () => {
  it('runs on memory when the key cannot be read, touching no file', () => {
    device.failures.secureRead = true;
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(STORED_KEY, { [THEME_KEY]: THEME_VALUE });
    seedFile(STORAGE_INSTANCE_ID, undefined, { [LIBRARY_KEY]: LIBRARY_VALUE });

    const storage = launch();
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect(storage.getString(THEME_KEY)).toBe(NEWER_THEME_VALUE);
    expect(fileEvents()).toStrictEqual(['secure.get']);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(THEME_VALUE);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual({ [LIBRARY_KEY]: LIBRARY_VALUE });
    expect(reportedProblems(captureError)).toStrictEqual(['key-unavailable']);
  });

  it('keeps the lost key files when the key cannot be read (a locked device is not a lost key)', () => {
    device.failures.secureRead = true;
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });

    launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(THEME_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual(['key-unavailable']);
  });

  it('runs on memory when the new key cannot be stored, opening no file', () => {
    device.failures.secureWrite = true;
    seedFile(STORAGE_INSTANCE_ID, undefined, { [LIBRARY_KEY]: LIBRARY_VALUE });

    const storage = launch();

    expect(storage.getString(LIBRARY_KEY)).toBeUndefined();
    expect(fileEvents()).toStrictEqual([
      'secure.get',
      `mmkv.exists:${APP_STORAGE_INSTANCE_ID}`,
      'secure.set',
    ]);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual({ [LIBRARY_KEY]: LIBRARY_VALUE });
    expect(reportedProblems(captureError)).toStrictEqual(['key-unavailable']);
  });

  it.each(BROKEN_SOURCES)(
    'runs on memory when the random source %s, storing no key',
    (_, source) => {
      getRandomValues.mockImplementationOnce(source);

      const storage = launch();
      storage.set(THEME_KEY, THEME_VALUE);

      expect(storage.getString(THEME_KEY)).toBe(THEME_VALUE);
      expect(device.secureItems.size).toBe(0);
      expect(device.configurations).toStrictEqual([]);
      expect(reportedProblems(captureError)).toStrictEqual(['key-unavailable']);
    },
  );
});

describe('openAppStorage, an instance that fails to open', () => {
  it('runs on memory, the new key kept for the next launch', () => {
    device.failures.create.add(APP_STORAGE_INSTANCE_ID);

    const storage = launch();
    storage.set(THEME_KEY, THEME_VALUE);

    expect(storage.getString(THEME_KEY)).toBe(THEME_VALUE);
    expect(device.files.has(APP_STORAGE_INSTANCE_ID)).toBe(false);
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(reportedProblems(captureError)).toStrictEqual(['open-failed']);
  });

  it('opens at the next launch with the key stored by the failed one', () => {
    device.failures.create.add(APP_STORAGE_INSTANCE_ID);
    launch();
    device.failures.create.clear();
    captureError.mockClear();

    launch().set(THEME_KEY, THEME_VALUE);

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(device.configurations.at(-1)?.encryptionKey).toBe(NEW_KEY);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(THEME_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('runs on memory when an existing instance cannot be opened, its files untouched', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(STORED_KEY, { [THEME_KEY]: THEME_VALUE });
    seedFile(STORAGE_INSTANCE_ID, undefined, { [LIBRARY_KEY]: LIBRARY_VALUE });
    device.failures.create.add(APP_STORAGE_INSTANCE_ID);

    expect(launch().getString(THEME_KEY)).toBeUndefined();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(THEME_VALUE);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual({ [LIBRARY_KEY]: LIBRARY_VALUE });
    expect(fileEvents()).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(reportedProblems(captureError)).toStrictEqual(['open-failed']);
  });

  it('runs on memory when the key check cannot be written', () => {
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 0 };

    expect(launch().getString(THEME_KEY)).toBeUndefined();
    expect(reportedProblems(captureError)).toStrictEqual(['open-failed']);
  });
});
