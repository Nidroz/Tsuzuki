import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedSecureItem } from './__fixtures__/app-storage-device';
import {
  CACHE_KEY,
  CACHE_VALUE,
  captureError,
  launch,
  LIBRARY_KEY,
  LIBRARY_VALUE,
  NEWER_THEME_VALUE,
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
  MIGRATED,
  seedLegacy,
} from './__fixtures__/app-storage-legacy';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import {
  APP_STORAGE_INSTANCE_ID,
  KEY_CHECK_KEY,
  KEY_CHECK_VALUE,
  LEGACY_COPIED_MARKER_KEY,
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

// a value the process running on the unencrypted instance adds after a failed copy
const SEARCHES_KEY = 'recent-searches';
const SEARCHES_VALUE = '["frieren"]';

const encryptedSets = () =>
  device.events.filter((event) => event.startsWith(`mmkv.set:${APP_STORAGE_INSTANCE_ID}:`));

beforeEach(resetLaunch);

describe('openAppStorage, the unencrypted instance of a previous version', () => {
  it('copies every value, writes the marker, then marks the unencrypted instance copied', () => {
    seedLegacy();

    const storage = launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(device.events.slice(-2)).toStrictEqual([
      `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${MIGRATED_MARKER_KEY}`,
      `mmkv.set:${STORAGE_INSTANCE_ID}:${LEGACY_COPIED_MARKER_KEY}`,
    ]);
    expect(device.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('deletes it at the next launch without opening it', () => {
    seedLegacy();
    launch();

    const { events } = launchWithEvents();

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
    expect(launchWithEvents().events).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('removes what the partial copy left first: a key deleted since never comes back', () => {
    // the guest library is copied first, then the copy fails
    seedLegacy({
      [LIBRARY_KEY]: LIBRARY_VALUE,
      [THEME_KEY]: THEME_VALUE,
      [CACHE_KEY]: CACHE_VALUE,
    });
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 2 };
    const fallback = launch();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[LIBRARY_KEY]).toBe(LIBRARY_VALUE);
    // the process on the unencrypted instance: the guest merge cleanup, a recent search
    fallback.delete(LIBRARY_KEY);
    fallback.set(SEARCHES_KEY, SEARCHES_VALUE);
    device.failures.setLimit = undefined;
    captureError.mockClear();

    const { storage, events } = launchWithEvents();

    expect(storage.getString(LIBRARY_KEY)).toBeUndefined();
    expect(storage.getString(SEARCHES_KEY)).toBe(SEARCHES_VALUE);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      [THEME_KEY]: THEME_VALUE,
      [CACHE_KEY]: CACHE_VALUE,
      [SEARCHES_KEY]: SEARCHES_VALUE,
      [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
    });
    expect(events.indexOf(`mmkv.remove:${APP_STORAGE_INSTANCE_ID}:${LIBRARY_KEY}`)).toBeLessThan(
      events.indexOf(`mmkv.set:${APP_STORAGE_INSTANCE_ID}:${THEME_KEY}`),
    );
    expect(events).not.toContain(`mmkv.remove:${APP_STORAGE_INSTANCE_ID}:${KEY_CHECK_KEY}`);
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
    // killed before the unencrypted instance was marked copied: the encrypted marker is enough
    seedLegacy();

    const storage = launch();

    expect(storage.getString(THEME_KEY)).toBe(NEWER_THEME_VALUE);
    expect(device.events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(encryptedSets()).toStrictEqual([]);
    expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('runs on the encrypted copy when the unencrypted instance cannot be marked copied', () => {
    seedLegacy();
    device.failures.setLimit = { id: STORAGE_INSTANCE_ID, remaining: 0 };

    const storage = launch();
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...MIGRATED,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(LEGACY_VALUES);
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);

    device.failures.setLimit = undefined;
    captureError.mockClear();
    const { events } = launchWithEvents();

    expect(events).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(NEWER_THEME_VALUE);
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
      expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
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
