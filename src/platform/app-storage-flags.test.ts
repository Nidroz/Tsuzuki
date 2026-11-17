import type { AppStorageProblem } from '@core/errors/app-storage-errors';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import { device, fileValues, seedSecureItem } from './__fixtures__/app-storage-device';
import {
  captureError,
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
import { seedLegacy } from './__fixtures__/app-storage-legacy';
import { reportedProblems } from './__fixtures__/app-storage-reports';
import { APP_STORAGE_INSTANCE_ID } from './app-storage-instance';
import { APP_STORAGE_KEY_NAME } from './app-storage-key';
import { STORAGE_INSTANCE_ID } from './app-storage-migration';

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

// a previous launch on the encrypted instance, its key stored
const seedLaunchWithFiles = (): void => {
  seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
  seedEncrypted(STORED_KEY, { [THEME_KEY]: THEME_VALUE });
};

// the stored key of an install the ios keychain outlived, no file left
const seedStaleKey = (): void => {
  seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
};

// whether a file of the device holds the value
const anyFileHolds = (value: string): boolean =>
  [...device.files.values()].some((file) => [...file.values.values()].includes(value));

// a memory process: nothing it writes reaches a file
const expectOnMemory = (storage: ReturnType<typeof launch>['storage']): void => {
  storage.set(LIBRARY_KEY, NEWER_THEME_VALUE);
  expect(storage.getString(LIBRARY_KEY)).toBe(NEWER_THEME_VALUE);
  expect(anyFileHolds(NEWER_THEME_VALUE)).toBe(false);
};

beforeEach(resetLaunch);

describe('openAppStorage, a first launch', () => {
  it('is persistent and a first launch without a stored key', () => {
    const { storage, persistent, firstLaunch } = launch();
    storage.set(LIBRARY_KEY, LIBRARY_VALUE);

    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: true });
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[LIBRARY_KEY]).toBe(LIBRARY_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('writes a new key over a stale one before creating the instance, reporting nothing', () => {
    seedStaleKey();

    const { persistent, firstLaunch } = launch();

    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: true });
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(NEW_KEY);
    expect(device.events.indexOf('secure.set')).toBeLessThan(
      device.events.indexOf(`mmkv.create:${APP_STORAGE_INSTANCE_ID}`),
    );
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('never reads a stale key: a secure store that cannot be read changes nothing', () => {
    seedStaleKey();
    device.failures.secureRead = true;

    const { persistent, firstLaunch } = launch();

    expect(device.events).not.toContain('secure.get');
    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: true });
    expect(device.configurations[0]?.encryptionKey).toBe(NEW_KEY);
    expect(reportedProblems(captureError)).toStrictEqual([]);
  });

  it('is not one at the launch after it', () => {
    launch();

    expect(launch().firstLaunch).toBe(false);
  });
});

describe('openAppStorage, a launch with files', () => {
  it('is persistent and not a first launch on the encrypted instance', () => {
    seedLaunchWithFiles();

    const { storage, persistent, firstLaunch } = launch();

    expect(storage.getString(THEME_KEY)).toBe(THEME_VALUE);
    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: false });
  });

  it('is not a first launch with the unencrypted instance only (an upgrade)', () => {
    seedLegacy();

    const { storage, persistent, firstLaunch } = launch();

    expect(storage.getString(LIBRARY_KEY)).toBe(LIBRARY_VALUE);
    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: false });
  });

  it('is persistent on the unencrypted fallback after a failed copy', () => {
    seedLegacy();
    // the key check and one value land, then the copy fails
    device.failures.setLimit = { id: APP_STORAGE_INSTANCE_ID, remaining: 2 };

    const { storage, persistent, firstLaunch } = launch();
    device.failures.setLimit = undefined;
    storage.set(THEME_KEY, NEWER_THEME_VALUE);

    expect({ persistent, firstLaunch }).toStrictEqual({ persistent: true, firstLaunch: false });
    expect(fileValues(STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(NEWER_THEME_VALUE);
    expect(reportedProblems(captureError)).toStrictEqual(['migration-failed']);
  });
});

// each way a process runs on memory: the setup, then whether it is a first launch, the problems
const MEMORY_CAUSES: readonly [string, () => void, boolean, readonly AppStorageProblem[]][] = [
  [
    'the key cannot be read',
    () => {
      seedLaunchWithFiles();
      device.failures.secureRead = true;
    },
    false,
    ['key-unavailable'],
  ],
  [
    'the new key of a first launch cannot be stored',
    () => {
      seedStaleKey();
      device.failures.secureWrite = true;
    },
    true,
    ['key-unavailable'],
  ],
  [
    'the random source of a first launch fails',
    () => {
      getRandomValues.mockImplementationOnce((array) => array);
    },
    true,
    ['key-unavailable'],
  ],
  [
    'the new key of a lost one cannot be stored',
    () => {
      seedEncrypted(OTHER_KEY, { [THEME_KEY]: THEME_VALUE });
      device.failures.secureWrite = true;
    },
    false,
    ['key-lost', 'key-unavailable'],
  ],
  [
    'the new instance of a first launch fails to open',
    () => {
      device.failures.create.add(APP_STORAGE_INSTANCE_ID);
    },
    true,
    ['open-failed'],
  ],
  [
    'an existing instance fails to open',
    () => {
      seedLaunchWithFiles();
      device.failures.create.add(APP_STORAGE_INSTANCE_ID);
    },
    false,
    ['open-failed'],
  ],
  [
    'the unencrypted instance cannot be opened',
    () => {
      seedLegacy();
      device.failures.create.add(STORAGE_INSTANCE_ID);
    },
    false,
    ['migration-failed'],
  ],
];

describe('openAppStorage, a process on memory', () => {
  it.each(MEMORY_CAUSES)('is not persistent when %s', (_, setUp, expectedFirstLaunch, problems) => {
    setUp();

    const { storage, persistent, firstLaunch } = launch();

    expect({ persistent, firstLaunch }).toStrictEqual({
      persistent: false,
      firstLaunch: expectedFirstLaunch,
    });
    expectOnMemory(storage);
    expect(reportedProblems(captureError)).toStrictEqual(problems);
  });
});

describe('openAppStorage, mmkv that cannot tell whether a file exists', () => {
  // not a first launch, the conservative value: no new key over one that may open the files
  const expectUntouchedOnMemory = (opened: ReturnType<typeof launch>): void => {
    expect({ persistent: opened.persistent, firstLaunch: opened.firstLaunch }).toStrictEqual({
      persistent: false,
      firstLaunch: false,
    });
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(STORED_KEY);
    expect(getRandomValues).not.toHaveBeenCalled();
    expectOnMemory(opened.storage);
    expect(reportedProblems(captureError)).toStrictEqual(['open-failed']);
  };

  it('runs on memory without reading the key when the encrypted instance is in doubt', () => {
    seedLaunchWithFiles();
    device.failures.exists.add(APP_STORAGE_INSTANCE_ID);

    const opened = launch();

    expect(device.events).toStrictEqual([`mmkv.exists:${APP_STORAGE_INSTANCE_ID}`]);
    expect(fileValues(APP_STORAGE_INSTANCE_ID)?.[THEME_KEY]).toBe(THEME_VALUE);
    expectUntouchedOnMemory(opened);
  });

  it('runs on memory, the stored key kept, when the unencrypted instance is in doubt', () => {
    seedStaleKey();
    device.failures.exists.add(STORAGE_INSTANCE_ID);

    const opened = launch();

    expect(device.events).toStrictEqual([
      `mmkv.exists:${APP_STORAGE_INSTANCE_ID}`,
      `mmkv.exists:${STORAGE_INSTANCE_ID}`,
    ]);
    expect(device.files.size).toBe(0);
    expectUntouchedOnMemory(opened);
  });
});
