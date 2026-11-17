// the device mocks below read this binding: imported first, before anything loads them
import * as mockDevice from '@platform/__fixtures__/app-storage-device';

import { AppStorageError } from '@core/errors/app-storage-errors';
import { QUERY_CACHE_STORAGE_KEY } from '@core/query/persister';
import { accountLibraryStorageKeys } from '@core/repositories/local/account-library-documents';
import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
import { GUEST_LIBRARY_STORAGE_KEY } from '@core/repositories/local/library-repository';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { describe, expect, it, jest } from '@jest/globals';
import type * as CryptoDevice from '@platform/__fixtures__/expo-crypto-device';
import { APP_STORAGE_INSTANCE_ID } from '@platform/app-storage-instance';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as AppRoutes from './app-routes';
import {
  appFileValues,
  launchInIsolation,
  seedEarlierLaunch,
  storedOwedPurges,
  USER_A,
  USER_C,
} from './app-storage-support';

// a sign out while the app storage runs on memory (R-09): the purge reaches memory only, so it
// records its user in the secure store first; the files keep everything until the next launch on
// them, which carries the owed purge into their purge-pending markers (the purge itself:
// root-layout-owed-purges-launch.test.tsx). every supabase factory is a fake: no real client

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

const SIGN_OUT_BUTTON = 'settings-account-sign-out';

// what the files hold from an earlier launch on them: A's copy and queue, C's, the device-wide
// data; stand-ins the memory process never reads
const keysOfA = accountLibraryStorageKeys(USER_A);
const keysOfC = accountLibraryStorageKeys(USER_C);
const FILES = {
  [keysOfA.copy]: 'device copy of A',
  [keysOfA.queue]: 'write queue of A',
  [keysOfC.copy]: 'device copy of C',
  [keysOfC.queue]: 'write queue of C',
  [RECENT_SEARCHES_STORAGE_KEY]: '["frieren"]',
  [QUERY_CACHE_STORAGE_KEY]: 'persisted cache of A',
  [GUEST_LIBRARY_STORAGE_KEY]: 'guest library of the files',
};

const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

describe('root layout sign out on a memory app storage (R-09)', () => {
  it('owes the purge of the signed-out user to the files, which the next launch carries', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    seedEarlierLaunch(FILES);
    const seeded = appFileValues();
    // the encrypted instance cannot be opened: this process runs on memory
    mockDevice.device.failures.create.add(APP_STORAGE_INSTANCE_ID);
    const { APP_ROUTES } = jest.requireActual<typeof AppRoutes>('./app-routes');
    const authModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
      '@core/repositories/supabase/auth-repository',
    );
    const { appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
      '../mobile/fake-supabase-module',
    );
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/settings' });
    // the local sign out ends the session, as supabase-js does
    appAuthRepositoryOf(authModule).signOut.mockImplementation(() => {
      authModule.sessionSource.emit(null);
      return Promise.resolve();
    });
    await act(async () => {
      authModule.sessionSource.emit({ userId: USER_A });
      await jest.advanceTimersByTimeAsync(0);
    });

    await userEvent.setup().press(await screen.findByTestId(SIGN_OUT_BUTTON));
    await settle();

    expect(appAuthRepositoryOf(authModule).signOut).toHaveBeenCalledTimes(1);
    // recorded in the secure store, the guest library never owed; the files untouched
    expect(storedOwedPurges()).toStrictEqual([
      { userId: USER_A, clearGuestLibrary: false, deviceWide: true },
    ]);
    expect(appFileValues()).toStrictEqual(seeded);
    expect(warn.mock.calls).toStrictEqual([['[app-storage]', new AppStorageError('open-failed')]]);
    await screen.unmount();

    // the next launch opens the files: the owed purge becomes their marker, for its driver
    mockDevice.device.failures.create.clear();
    launchInIsolation();

    expect(storedOwedPurges()).toStrictEqual([]);
    expect(JSON.parse(String(appFileValues()?.[DEVICE_PURGE_MARKER_STORAGE_KEY]))).toStrictEqual({
      version: 1,
      users: [{ userId: USER_A, clearGuestLibrary: false, deviceWide: true }],
    });
    expect(appFileValues()?.[keysOfA.queue]).toBe(FILES[keysOfA.queue]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
