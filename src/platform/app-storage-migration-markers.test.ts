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
  NEW_INSTANCE,
  NEWER_THEME_VALUE,
  resetLaunch,
  seedEncrypted,
  STORED_KEY,
  THEME_KEY,
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

// the sets on the encrypted instance before its marker: the key check, then each copied value
const SETS_BEFORE_THE_MARKER = 1 + Object.keys(LEGACY_VALUES).length;

const MARKER_SET = `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${MIGRATED_MARKER_KEY}`;

// the value writes and removals of the encrypted instance among the events
const encryptedWrites = (events: readonly string[]): string[] =>
  events.filter(
    (event) =>
      event.startsWith(`mmkv.set:${APP_STORAGE_INSTANCE_ID}:`) ||
      event.startsWith(`mmkv.remove:${APP_STORAGE_INSTANCE_ID}:`),
  );

// the next launch deletes the unencrypted instance without opening it
const expectDeletedUnopened = (events: readonly string[]): void => {
  expect(events).toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
  expect(events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
  expect(device.files.has(STORAGE_INSTANCE_ID)).toBe(false);
};

beforeEach(resetLaunch);

describe('openAppStorage, the copied marker that cannot be written', () => {
  it('keeps the unencrypted instance as the storage, copied again at the next launch', () => {
    seedLegacy();
    device.failures.setLimit = { id: STORAGE_INSTANCE_ID, remaining: 0 };

    const storage = launch();
    device.failures.setLimit = undefined;
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual({
      ...LEGACY_VALUES,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      ...LEGACY_VALUES,
    });
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);

    captureError.mockClear();
    const next = launchWithEvents();

    expect(next.storage.getString(THEME_KEY)).toBe(NEWER_THEME_VALUE);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...MIGRATED,
      [THEME_KEY]: NEWER_THEME_VALUE,
    });
    expect(next.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('never undoes a purge of that process when the key is lost before the next launch', () => {
    seedLegacy();
    device.failures.setLimit = { id: STORAGE_INSTANCE_ID, remaining: 0 };
    const storage = launch();
    device.failures.setLimit = undefined;
    // a sign out purge on the unencrypted instance, then the key goes
    storage.delete(LIBRARY_KEY);
    device.secureItems.delete(APP_STORAGE_KEY_NAME);
    captureError.mockClear();

    const next = launch();

    expect(next.getString(LIBRARY_KEY)).toBeUndefined();
    expect(next.getString(CACHE_KEY)).toBe(CACHE_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual(['key-lost']);
  });
});

describe('openAppStorage, the encrypted marker that cannot be written', () => {
  it('runs on the encrypted copy, marked at the next launch without copying, kept writes', () => {
    seedLegacy();
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: SETS_BEFORE_THE_MARKER };

    const storage = launch();
    device.failures.setLimit = undefined;
    storage.set(THEME_KEY, NEWER_THEME_VALUE);
    storage.delete(LIBRARY_KEY);

    expect(fileValues(STORAGE_INSTANCE_ID)).toStrictEqual(COPIED_LEGACY);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      [THEME_KEY]: NEWER_THEME_VALUE,
      [CACHE_KEY]: CACHE_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);

    captureError.mockClear();
    const next = launchWithEvents();

    expect(next.storage.getString(LIBRARY_KEY)).toBeUndefined();
    expect(encryptedWrites(next.events)).toStrictEqual([MARKER_SET]);
    // opened by this launch, so kept by it
    expect(next.events).toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(next.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);

    expectDeletedUnopened(launchWithEvents().events);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      [THEME_KEY]: NEWER_THEME_VALUE,
      [CACHE_KEY]: CACHE_VALUE,
      [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('copies nothing and removes nothing after a kill between the two markers', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    seedEncrypted(STORED_KEY, LEGACY_VALUES);
    seedLegacy(COPIED_LEGACY);

    const next = launchWithEvents();

    expect(next.storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect(encryptedWrites(next.events)).toStrictEqual([MARKER_SET]);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(MIGRATED);
    expect(next.events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);

    expectDeletedUnopened(launchWithEvents().events);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});

describe('openAppStorage, no unencrypted instance', () => {
  it('marks a fresh install migrated, right after the key check', () => {
    const { events } = launchWithEvents();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual(NEW_INSTANCE);
    expect(encryptedWrites(events)).toStrictEqual([
      `mmkv.set:${APP_STORAGE_INSTANCE_ID}:${KEY_CHECK_KEY}`,
      MARKER_SET,
    ]);
    expect(events).not.toContain(`mmkv.create:${STORAGE_INSTANCE_ID}`);
    expect(events).not.toContain(`mmkv.delete:${STORAGE_INSTANCE_ID}`);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('keeps the encrypted instance when the marker cannot be written, marked at the next launch', () => {
    // the key check lands, then the marker fails
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 1 };

    const storage = launch();
    device.failures.setLimit = undefined;
    storage.set(LIBRARY_KEY, LIBRARY_VALUE);

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
      [LIBRARY_KEY]: LIBRARY_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);

    captureError.mockClear();
    launch();

    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...NEW_INSTANCE,
      [LIBRARY_KEY]: LIBRARY_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('deletes a stray unencrypted instance unopened, removing nothing from the encrypted one', () => {
    launch().set(LIBRARY_KEY, LIBRARY_VALUE);
    // against the precondition: an unencrypted instance created after the fresh install
    seedLegacy();

    const next = launchWithEvents();

    expectDeletedUnopened(next.events);
    expect(encryptedWrites(next.events)).toStrictEqual([]);
    expect(next.storage.getString(THEME_KEY)).toBeUndefined();
    expect(fileValues(APP_STORAGE_INSTANCE_ID)).toStrictEqual({
      ...NEW_INSTANCE,
      [LIBRARY_KEY]: LIBRARY_VALUE,
    });
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });
});
