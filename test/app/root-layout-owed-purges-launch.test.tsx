// the device mocks below read this binding: imported first, before anything loads them
import * as mockDevice from '@platform/__fixtures__/app-storage-device';

import { CACHE_SCHEMA_VERSION } from '@core/query/cache-schema-version';
import { QUERY_CACHE_STORAGE_KEY } from '@core/query/persister';
import { accountLibraryStorageKeys } from '@core/repositories/local/account-library-documents';
import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
import { GUEST_LIBRARY_STORAGE_KEY } from '@core/repositories/local/library-repository';
import { serializeGuestLibrary } from '@core/repositories/local/library-store';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { describe, expect, it, jest } from '@jest/globals';
import type * as CryptoDevice from '@platform/__fixtures__/expo-crypto-device';
import { APP_VERSION } from '@platform/app-version';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';

import { entryOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as AppRoutes from './app-routes';
import {
  appFileValues,
  owedPurgesOnDevice,
  seedEarlierLaunch,
  storedOwedPurges,
  USER_A,
  USER_C,
} from './app-storage-support';

// the launch on the files after a process that ran its app storage on memory (R-09): the purge
// that process owed (root-layout-owed-purges.test.tsx) is carried into the purge-pending markers
// and run by the launch purge, signed out: that user's copy and queue, the recent searches and the
// persisted cache go; the guest library (never owed) and another user's documents stay. every
// supabase factory is a fake: no real client

jest.mock('react-native-mmkv', () => mockDevice.fakeMmkvModule());
jest.mock('expo-secure-store', () => mockDevice.fakeSecureStoreModule());
jest.mock('expo-crypto', () =>
  jest
    .requireActual<typeof CryptoDevice>('@platform/__fixtures__/expo-crypto-device')
    .fakeExpoCryptoModule(),
);
jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);
jest.mock('@core/repositories/supabase/library-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseLibraryModule(),
);
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);
jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

const keysOfA = accountLibraryStorageKeys(USER_A);
const keysOfC = accountLibraryStorageKeys(USER_C);
const CACHED_TEXT = 'cached before the purge';
const GUEST_LIBRARY = serializeGuestLibrary([entryOf()]);

// a persisted cache this build restores (its buster), holding one catalog query
const persistedCache = (): string => {
  const now = Date.now();
  return JSON.stringify({
    timestamp: now,
    buster: `${APP_VERSION}+${String(CACHE_SCHEMA_VERSION)}`,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ['probe'],
          queryHash: '["probe"]',
          state: {
            data: CACHED_TEXT,
            dataUpdateCount: 1,
            dataUpdatedAt: now,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'success',
            fetchStatus: 'idle',
          },
        },
      ],
    },
  });
};

describe('root layout launch after a memory app storage (R-09)', () => {
  it('purges the owed user from the files, keeping the guest library and other users', async () => {
    seedEarlierLaunch({
      [keysOfA.copy]: 'device copy of A',
      [keysOfA.queue]: 'write queue of A',
      [keysOfC.copy]: 'device copy of C',
      [keysOfC.queue]: 'write queue of C',
      [RECENT_SEARCHES_STORAGE_KEY]: '["frieren"]',
      [QUERY_CACHE_STORAGE_KEY]: persistedCache(),
      [GUEST_LIBRARY_STORAGE_KEY]: GUEST_LIBRARY,
    });
    owedPurgesOnDevice().add({ userId: USER_A, clearGuestLibrary: false, deviceWide: true });
    const { APP_ROUTES } = jest.requireActual<typeof AppRoutes>('./app-routes');

    await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    const files = appFileValues() ?? {};
    expect(files[keysOfA.copy]).toBeUndefined();
    expect(files[keysOfA.queue]).toBeUndefined();
    expect(files[RECENT_SEARCHES_STORAGE_KEY]).toBeUndefined();
    expect(String(files[QUERY_CACHE_STORAGE_KEY] ?? '')).not.toContain(CACHED_TEXT);
    expect(files[GUEST_LIBRARY_STORAGE_KEY]).toBe(GUEST_LIBRARY);
    expect(files[keysOfC.copy]).toBe('device copy of C');
    expect(files[keysOfC.queue]).toBe('write queue of C');
    // the owed purge was carried, then settled
    expect(storedOwedPurges()).toStrictEqual([]);
    expect(files[DEVICE_PURGE_MARKER_STORAGE_KEY]).toBeUndefined();
  });
});
