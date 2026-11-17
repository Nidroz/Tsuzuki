import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import {
  device,
  fileValues,
  GARBAGE_VALUE,
  seedSecureItem,
  setWrongKeyRead,
} from './__fixtures__/app-storage-device';
import {
  captureError,
  getRandomValues,
  launch,
  LIBRARY_KEY,
  LIBRARY_VALUE,
  NEW_INSTANCE,
  NEW_KEY,
  OTHER_KEY,
  resetLaunch,
  seedEncrypted,
  SESSION_OPTIONS,
  STORED_KEY,
  THEME_KEY,
  THEME_VALUE,
} from './__fixtures__/app-storage-launch';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import {
  APP_STORAGE_INSTANCE_ID,
  KEY_CHECK_KEY,
  MIGRATED_MARKER_KEY,
} from './app-storage-instance';
import { APP_STORAGE_KEY_NAME } from './app-storage-key';

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

beforeEach(resetLaunch);

describe('openAppStorage, first launch', () => {
  it('generates a key from the injected source and stores it before creating the instance', () => {
    launch();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    // without a file there is no key to read: only the write of the new one
    expect(device.secureOptions).toStrictEqual([SESSION_OPTIONS]);
    expect(device.events).not.toContain('secure.get');
    expect(device.events.indexOf('secure.set')).toBeLessThan(
      device.events.indexOf(`mmkv.create:${APP_STORAGE_INSTANCE_ID}`),
    );
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('opens one aes-256 instance with the new key, writes the key check first, then the marker', () => {
    launch();

    expect(device.configurations).toStrictEqual([
      { id: APP_STORAGE_INSTANCE_ID, encryptionKey: NEW_KEY, encryptionType: 'AES-256' },
    ]);
    expect(device.events.filter((event) => event.startsWith('mmkv.set:'))).toStrictEqual([
      `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${KEY_CHECK_KEY}`,
      `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${MIGRATED_MARKER_KEY}`,
    ]);
  });

  it('stores what the app writes in the encrypted instance', () => {
    const { storage } = launch();

    storage.set(THEME_KEY, THEME_VALUE);
    storage.set(LIBRARY_KEY, LIBRARY_VALUE);
    storage.delete(LIBRARY_KEY);

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...NEW_INSTANCE,
      [THEME_KEY]: THEME_VALUE,
    });
    expect(storage.getString(THEME_KEY)).toBe(THEME_VALUE);
  });
});

describe('openAppStorage, a stored key', () => {
  it('opens the instance with it, without a new key or a secure-store write', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(STORED_KEY, { [THEME_KEY]: THEME_VALUE });

    const { storage } = launch();

    expect(storage.getString(THEME_KEY)).toBe(THEME_VALUE);
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(device.events).not.toContain('secure.set');
    expect(device.configurations[0]?.encryptionKey).toBe(STORED_KEY);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('reads at the next launch what this one wrote', () => {
    launch().storage.set(LIBRARY_KEY, LIBRARY_VALUE);

    const { storage: next } = launch();

    expect(next.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('never uses a key stored without a file (the keychain outlived a reinstall): a new one', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);

    launch();

    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(device.configurations).toStrictEqual([
      { id: APP_STORAGE_INSTANCE_ID, encryptionKey: NEW_KEY, encryptionType: 'AES-256' },
    ]);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(NEW_INSTANCE);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});

describe('openAppStorage, a key that does not open the instance', () => {
  it.each(['discard', 'garbage'] as const)(
    'clears the instance and writes the key check (wrong key read: %s)',
    (read) => {
      setWrongKeyRead(read);
      seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
      seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });

      const { storage } = launch();

      expect(storage.getString(THEME_KEY)).toBeUndefined();
      expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(NEW_INSTANCE);
      expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(STORED_KEY);
      expect(reportedProblems(captureError)).toStrictEqual(['key-mismatch']);
    },
  );

  it('opens cleanly at the next launch', () => {
    setWrongKeyRead('garbage');
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });
    launch().storage.set(THEME_KEY, THEME_VALUE);
    captureError.mockClear();

    expect(launch().storage.getString(THEME_KEY)).toBe(THEME_VALUE);
    expect(Object.values(fileValues(APP_STORAGE_INSTANCE_ID) ?? {})).not.toContain(GARBAGE_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});
