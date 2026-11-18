// the device mocks below read this binding: imported first, before anything loads them
import * as mockDevice from '@platform/__fixtures__/app-storage-device';

import type * as AppStorageErrors from '@core/errors/app-storage-errors';
import type * as AuthErrors from '@core/errors/auth-errors';
import {
  accountLibraryStorageKeys,
  serializeAccountCopy,
  serializeAccountQueue,
} from '@core/repositories/local/account-library-documents';
import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
import { GUEST_LIBRARY_STORAGE_KEY } from '@core/repositories/local/library-repository';
import { serializeGuestLibrary } from '@core/repositories/local/library-store';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as CryptoDevice from '@platform/__fixtures__/expo-crypto-device';
import { APP_STORAGE_INSTANCE_ID } from '@platform/app-storage-instance';
import type * as Localization from 'expo-localization';

import { entryOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import {
  appFileValues,
  renderLaunchInIsolation,
  seedEarlierLaunch,
  storedOwedPurges,
  USER_A,
  USER_C,
  warmUpRenderedLaunch,
  type RenderedLaunch,
} from './app-storage-support';

// a sign out killed inside `signOut()` while the app storage runs on memory (R-09): the purge is
// owed to the files before the session ends, so the next launch on the files purges that user
// even though the memory process never reached its purge; a sign out that rejected while still
// signed in leaves the owed purge too, and the next launch, that session restored, unmarks the
// user and purges nothing. each launch renders in its own module registry (renderLaunchInIsolation):
// this file's main registry loads no react, router or layout. every supabase factory is a fake

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
const NEVER_SETTLES = new Promise<void>(() => undefined);

// what the files hold from an earlier launch on them: A's copy and queue, C's, the recent
// searches. A's documents are valid: a launch that restores A's session reads them; C's are
// stand-ins no launch reads
const keysOfA = accountLibraryStorageKeys(USER_A);
const keysOfC = accountLibraryStorageKeys(USER_C);
const RECENT_SEARCHES = '["frieren"]';
const FILES = {
  [keysOfA.copy]: serializeAccountCopy([]),
  [keysOfA.queue]: serializeAccountQueue({ nextSeq: 1, records: [] }),
  [keysOfC.copy]: 'device copy of C',
  [keysOfC.queue]: 'write queue of C',
  [RECENT_SEARCHES_STORAGE_KEY]: RECENT_SEARCHES,
};
const GUEST_LIBRARY = serializeGuestLibrary([entryOf()]);

const OWED_OF_A = { userId: USER_A, clearGuestLibrary: false, deviceWide: true };

const settle = async ({ testing }: RenderedLaunch) => {
  await testing.act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

// user A signs out in a process whose app storage runs on memory, `signOut()` being `signOut`,
// called inside that process's module registry; the process then ends, whatever is pending
const signOutOnMemory = async (signOut: () => Promise<void>) => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockDevice.device.failures.create.add(APP_STORAGE_INSTANCE_ID);
  await renderLaunchInIsolation('/settings', async (launch) => {
    const { appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
      '../mobile/fake-supabase-module',
    );
    appAuthRepositoryOf(launch.auth).signOut.mockImplementation(signOut);
    await launch.testing.act(async () => {
      launch.auth.sessionSource.emit({ userId: USER_A });
      await jest.advanceTimersByTimeAsync(0);
    });

    await launch.testing.userEvent
      .setup()
      .press(await launch.testing.screen.findByTestId(SIGN_OUT_BUTTON));
    await settle(launch);

    expect(appAuthRepositoryOf(launch.auth).signOut).toHaveBeenCalledTimes(1);
    const { AppStorageError } = jest.requireActual<typeof AppStorageErrors>(
      '@core/errors/app-storage-errors',
    );
    expect(warn.mock.calls).toStrictEqual([['[app-storage]', new AppStorageError('open-failed')]]);
  });
  warn.mockRestore();
  mockDevice.device.failures.create.clear();
};

// every launch below loads the whole app, the testing library and the router in a fresh module
// registry. the first load of those modules (their transforms read from the cache) takes most of
// a cold run: it happens here, as the file loads, outside the tests' timeout, as the top-level
// imports of the other route tests do. it writes to the device, which each test resets
warmUpRenderedLaunch();

beforeEach(() => {
  mockDevice.resetDevice();
});

describe('root layout sign out killed on a memory app storage (R-09)', () => {
  it('owes the purge before signOut(): the next launch on the files purges that user', async () => {
    seedEarlierLaunch({ ...FILES, [GUEST_LIBRARY_STORAGE_KEY]: GUEST_LIBRARY });
    const seeded = appFileValues();

    // the revocation hangs, then the process is killed: no purge, no session ended
    await signOutOnMemory(() => NEVER_SETTLES);

    expect(storedOwedPurges()).toStrictEqual([OWED_OF_A]);
    expect(appFileValues()).toStrictEqual(seeded);

    // the next launch opens the files, signed out (the revocation reached the server)
    await renderLaunchInIsolation('/', settle);

    const files = appFileValues() ?? {};
    expect(files[keysOfA.copy]).toBeUndefined();
    expect(files[keysOfA.queue]).toBeUndefined();
    expect(files[RECENT_SEARCHES_STORAGE_KEY]).toBeUndefined();
    // never owed: the guest library of the files, another user's documents
    expect(files[GUEST_LIBRARY_STORAGE_KEY]).toBe(GUEST_LIBRARY);
    expect(files[keysOfC.copy]).toBe(FILES[keysOfC.copy]);
    expect(files[keysOfC.queue]).toBe(FILES[keysOfC.queue]);
    expect(storedOwedPurges()).toStrictEqual([]);
    expect(files[DEVICE_PURGE_MARKER_STORAGE_KEY]).toBeUndefined();
  });

  it('purges nothing at the next launch that restores the session of a sign out that rejected', async () => {
    seedEarlierLaunch(FILES);
    // offline: the session stays, the sign out fails while still signed in
    await signOutOnMemory(() => {
      // required inside the launch's registry: the app checks the class of what it caught
      const { AuthError } = jest.requireActual<typeof AuthErrors>('@core/errors/auth-errors');
      return Promise.reject(new AuthError('network'));
    });

    // the owed purge outlives the failed sign out: only a launch on the files settles it
    expect(storedOwedPurges()).toStrictEqual([OWED_OF_A]);

    await renderLaunchInIsolation('/', settle, ({ auth }) => {
      auth.sessionSource.emit({ userId: USER_A });
    });

    const files = appFileValues() ?? {};
    // carried, then unmarked: the session's user keeps their documents and the device's data
    expect(storedOwedPurges()).toStrictEqual([]);
    expect(files[DEVICE_PURGE_MARKER_STORAGE_KEY]).toBeUndefined();
    expect(files[keysOfA.copy]).toBeDefined();
    expect(files[RECENT_SEARCHES_STORAGE_KEY]).toBe(RECENT_SEARCHES);
    expect(files[keysOfC.copy]).toBe(FILES[keysOfC.copy]);
  });
});
