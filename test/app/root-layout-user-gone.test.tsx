import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
import { PERSIST_THROTTLE_MS, QUERY_CACHE_STORAGE_KEY } from '@core/query/persister';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
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
  documentsOf,
  ENTRY_A,
  ENTRY_B,
  libraryTab,
  pressTab,
  queuedWritesOf,
  rowOf,
  seedDocumentsOfC,
  settle,
  signOutMocks,
  USER_A,
  USER_B,
  USER_C,
} from './sign-out-support';

// the purge of a user the auth server reports gone (ADR-0018, update of 2026-11-04), through the
// composition root over the real app storage: the session's user gone is signed out and their
// documents purged; a report for another user touches that user's documents only; a session that
// ends without a report purges nothing. every supabase factory is a fake (no real client), the
// device network a fake driving the real connectivity binding

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
const { userGoneSource } = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
  '@core/repositories/supabase/auth-repository',
);

const RECENT_SEARCHES = JSON.stringify(['frieren']);

// the auth repository reports `userId` gone, then what it starts settles
const reportGone = async (userId: string) => {
  await act(async () => {
    userGoneSource.report(userId);
    await jest.advanceTimersByTimeAsync(0);
  });
};

// user A signed in on the library tab with a recent search and one change queued offline
const signInAWithQueuedChange = async () => {
  appStorage.set(RECENT_SEARCHES_STORAGE_KEY, RECENT_SEARCHES);
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
  await mocks.reportSession(USER_A);
  await pressTab('library');
  expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
  await mocks.setDeviceOnline(false);
  await addOneEpisode(ENTRY_A);
  expect(queuedWritesOf(USER_A)).toHaveLength(1);
};

beforeEach(() => {
  mocks.reset();
  seedDocumentsOfC();
});

afterEach(async () => {
  await mocks.restore();
});

describe('root layout purge of a user gone (A-10)', () => {
  it("signs the session's user out and purges their documents, another user's kept", async () => {
    await signInAWithQueuedChange();
    const documentsOfC = documentsOf(USER_C);

    await reportGone(USER_A);

    expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
    expect(documentsOf(USER_A)).toStrictEqual({ copy: undefined, queue: undefined });
    expect(appStorage.getString(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBeUndefined();
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBeUndefined();
    expect(documentsOf(USER_C)).toStrictEqual(documentsOfC);
    // the guest library shows, without A's entries
    expect(libraryTab().queryByTestId(rowOf(ENTRY_A))).not.toBeOnTheScreen();
    await pressTab('settings');
    expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();

    // a repeat of the report after the purge changes nothing more
    await reportGone(USER_A);

    expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
    expect(documentsOf(USER_A)).toStrictEqual({ copy: undefined, queue: undefined });
  });

  it("purges only the gone user's documents while another user is signed in", async () => {
    await signInAWithQueuedChange();
    // user B signs in on this device (no sign out of A: A's queue waits, ADR-0017), offline
    await mocks.setDeviceOnline(true);
    await mocks.reportSession(USER_B);
    expect(await libraryTab().findByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
    await mocks.setDeviceOnline(false);
    await addOneEpisode(ENTRY_B);
    await settle(PERSIST_THROTTLE_MS);
    const documentsOfB = documentsOf(USER_B);
    expect(queuedWritesOf(USER_B)).toHaveLength(1);
    const persistedCache = appStorage.getString(QUERY_CACHE_STORAGE_KEY);
    const queries = mocks.queryClient().getQueryCache().getAll().length;

    // a late report of A, the user signed in before
    await reportGone(USER_A);

    expect(mocks.auth().signOut).not.toHaveBeenCalled();
    expect(documentsOf(USER_A)).toStrictEqual({ copy: undefined, queue: undefined });
    expect(appStorage.getString(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBeUndefined();
    expect(documentsOf(USER_B)).toStrictEqual(documentsOfB);
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBe(RECENT_SEARCHES);
    expect(appStorage.getString(QUERY_CACHE_STORAGE_KEY)).toBe(persistedCache);
    expect(mocks.queryClient().getQueryCache().getAll()).toHaveLength(queries);
    expect(libraryTab().getByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
  });

  it('purges nothing when the session ends without a report, and A finds the queue at the next sign in', async () => {
    await signInAWithQueuedChange();
    const documentsOfA = documentsOf(USER_A);

    // a refused refresh of a revoked session, an expired token, offline: the session just ends
    await mocks.reportSession(null);

    expect(documentsOf(USER_A)).toStrictEqual(documentsOfA);
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBe(RECENT_SEARCHES);
    expect(appStorage.getString(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBeUndefined();

    await mocks.reportSession(USER_A);

    expect(queuedWritesOf(USER_A)).toHaveLength(1);
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
  });
});
