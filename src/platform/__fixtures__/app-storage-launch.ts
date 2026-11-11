import type { ErrorReporter } from '@core/errors/error-reporter';
import { jest } from '@jest/globals';

import { openAppStorage } from '../app-storage';
import { APP_STORAGE_INSTANCE_ID, KEY_CHECK_KEY, KEY_CHECK_VALUE } from '../app-storage-instance';
import {
  device,
  FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  repeatingRandomSource,
  resetDevice,
  seedFile,
  withoutMathRandom,
} from './app-storage-device';

/**
 * one app launch over the fake device (app-storage-device.ts), for the openAppStorage tests. a
 * test file using it mocks react-native-mmkv and expo-secure-store with the fake modules first
 */

// each byte & 63 picks a character: 0, 8, 16, ... 56 are A I Q Y g o w 4
const NEW_KEY_BYTES = [0, 8, 16, 24, 32, 40, 48, 56];
export const NEW_KEY = 'AIQYgow4'.repeat(4);
export const STORED_KEY = 'Stored-key_0123456789abcdefghijk';
export const OTHER_KEY = 'Other-key_0123456789abcdefghijkl';

// stored keys and values that look like the app's; no report may quote one
export const THEME_KEY = 'preferences.theme';
export const THEME_VALUE = 'theme-dark-value';
export const NEWER_THEME_VALUE = 'theme-light-value';
export const LIBRARY_KEY = 'guest-library';
export const LIBRARY_VALUE = '{"entries":[{"notes":"rewatch the finale"}]}';
export const CACHE_KEY = 'query-cache';
export const CACHE_VALUE = '{"clientState":{"queries":[{"queryHash":"[\\"search\\"]"}]}}';

export const SESSION_OPTIONS = { keychainAccessible: FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const captureError = jest.fn<ErrorReporter['captureError']>();
export const getRandomValues = jest.fn<(array: Uint8Array) => Uint8Array>();

/** a fresh device and fresh mocks; the random source gives NEW_KEY. */
export const resetLaunch = (): void => {
  resetDevice();
  captureError.mockReset();
  getRandomValues.mockReset();
  getRandomValues.mockImplementation(repeatingRandomSource(NEW_KEY_BYTES));
};

/** one launch of the app: the device files outlive it. it never uses Math.random. */
export const launch = () =>
  withoutMathRandom(() => openAppStorage({ reporter: { captureError }, getRandomValues }));

/** an encrypted instance as a previous launch left it (its key check included). */
export const seedEncrypted = (key: string, values: Readonly<Record<string, string>>): void => {
  seedFile(APP_STORAGE_INSTANCE_ID, key, { [KEY_CHECK_KEY]: KEY_CHECK_VALUE, ...values });
};

/** the native events of the files and the secure store, without the value writes. */
export const fileEvents = (): string[] =>
  device.events.filter((event) => !event.startsWith('mmkv.set:'));
