import { AuthError } from '@core/errors/auth-errors';
import { PERSIST_THROTTLE_MS, QUERY_CACHE_STORAGE_KEY } from '@core/query/persister';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as RecordingQueryClient from '../mobile/recording-query-client';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import {
  addOneEpisode,
  appStorage,
  ENTRY_A,
  libraryTab,
  pressTab,
  queuedWritesOf,
  rowOf,
  settle,
  SIGN_OUT_BUTTON,
  signOutMocks,
  storedCopyOf,
  storedQueueOf,
  tapAccount,
  UNSYNCED_SHEET,
  USER_A,
} from './sign-out-support';

// a sign out that does not happen purges nothing (A-06, FR-25, ADR-0018): Cancel in the unsynced
// sheet, or a sign out the auth server refuses after the user confirmed, leaves the user signed in
// with their library copy, write queue, recent searches and caches as they were. every supabase
// factory is a fake (no real client), the device network a fake driving the real connectivity
// binding

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
jest.mock('@core/query/query-client', () =>
  jest
    .requireActual<typeof RecordingQueryClient>('../mobile/recording-query-client')
    .recordingQueryClientModule(),
);

// no http: the Discover tab gets an empty top list, the other tabs read no catalog data
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-network', () =>
  jest.requireActual<typeof FakeNetworkModule>('../mobile/fake-network-module').fakeNetworkModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test read it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const mocks = signOutMocks();

// a recent search of A, stored as the recent searches repository stores it
const RECENT_SEARCHES = JSON.stringify(['frieren']);
const UNSYNCED_MESSAGE =
  '1 change made on this device has not reached your account yet. Signing out deletes it from this device.';
const NETWORK_ERROR = 'The server could not be reached. Check your connection, then try again.';

// what a purge would delete: the stored documents and the queries of the cache
const deviceData = () => ({
  copy: storedCopyOf(USER_A),
  queue: storedQueueOf(USER_A),
  recentSearches: appStorage.getString(RECENT_SEARCHES_STORAGE_KEY),
  persistedCache: appStorage.getString(QUERY_CACHE_STORAGE_KEY),
  queries: mocks
    .queryClient()
    .getQueryCache()
    .getAll()
    .map(({ queryHash }) => queryHash),
});

// user A signed in with a recent search, the Discover top list persisted, and one change of the
// library queued offline; then the Sign out tap, which asks first
const signInWithUnsyncedChange = async () => {
  appStorage.set(RECENT_SEARCHES_STORAGE_KEY, RECENT_SEARCHES);
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
  await mocks.reportSession(USER_A);
  await settle(PERSIST_THROTTLE_MS);
  await pressTab('library');
  expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
  await mocks.setDeviceOnline(false);
  await addOneEpisode(ENTRY_A);
  expect(queuedWritesOf(USER_A)).toHaveLength(1);
  // the throttled save of the cache has run
  await settle(PERSIST_THROTTLE_MS);
  const before = deviceData();
  expect(before.persistedCache).toBeDefined();
  expect(before.copy).toBeDefined();

  await pressTab('settings');
  await tapAccount(SIGN_OUT_BUTTON);
  expect(screen.getByTestId(UNSYNCED_SHEET)).toHaveTextContent(UNSYNCED_MESSAGE, {
    exact: false,
  });
  return before;
};

beforeEach(() => {
  mocks.reset();
});

afterEach(async () => {
  await mocks.restore();
});

describe('root layout sign out that does not happen (A-06)', () => {
  it('keeps A signed in with every device data when A cancels in the unsynced sheet', async () => {
    const before = await signInWithUnsyncedChange();

    await tapAccount(`${UNSYNCED_SHEET}-cancel`);

    expect(screen.queryByTestId(UNSYNCED_SHEET)).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings-account-signed-in')).toBeOnTheScreen();
    expect(mocks.auth().signOut).not.toHaveBeenCalled();
    expect(deviceData()).toStrictEqual(before);
    await pressTab('library');
    expect(libraryTab().getByTestId(rowOf(ENTRY_A))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
  });

  it('keeps A signed in with every device data when the sign out fails after A confirmed', async () => {
    mocks.auth().signOut.mockImplementation(() => Promise.reject(new AuthError('network')));
    const before = await signInWithUnsyncedChange();

    await tapAccount(`${UNSYNCED_SHEET}-confirm`);

    expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-account-error')).toHaveTextContent(NETWORK_ERROR);
    expect(screen.getByTestId('settings-account-signed-in')).toBeOnTheScreen();
    expect(screen.queryByTestId(UNSYNCED_SHEET)).not.toBeOnTheScreen();
    expect(deviceData()).toStrictEqual(before);
    await pressTab('library');
    expect(libraryTab().getByTestId(rowOf(ENTRY_A))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
  });
});
