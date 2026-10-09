import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as AppVersionModule from './app-version';

let mockExpoConfig: { version?: string } | null = null;

// the factory runs when the module is imported: it reads the config lazily
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

// the version is read once at import: each case imports a fresh module
const loadAppVersion = (): typeof AppVersionModule => {
  let loaded: typeof AppVersionModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<typeof AppVersionModule>('./app-version');
  });
  if (loaded === undefined) throw new Error('app-version did not load');
  return loaded;
};

beforeEach(() => {
  mockExpoConfig = null;
});

describe('APP_VERSION', () => {
  it('is the version of the app config', () => {
    mockExpoConfig = { version: '1.4.2' };

    expect(loadAppVersion().APP_VERSION).toBe('1.4.2');
  });

  it('falls back when the config has no version', () => {
    mockExpoConfig = {};

    const { APP_VERSION, UNKNOWN_APP_VERSION } = loadAppVersion();

    expect(APP_VERSION).toBe(UNKNOWN_APP_VERSION);
  });

  it('falls back when there is no config', () => {
    const { APP_VERSION, UNKNOWN_APP_VERSION } = loadAppVersion();

    expect(APP_VERSION).toBe(UNKNOWN_APP_VERSION);
  });
});
