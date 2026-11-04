import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
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
  deviceMarkers,
  documentsOf,
  ENTRY_A,
  libraryTab,
  pressTab,
  queuedWritesOf,
  rowOf,
  seedDocumentsOfC,
  settle,
  signOutMocks,
  storedMarkers,
  USER_A,
  USER_C,
} from './sign-out-support';

// the purge-pending marker across launches (ADR-0018, update of 2026-11-04): a sign out killed
// after the session ended and before the purge leaves its marker, and the next launch of the
// composition root purges that user's documents from the real app storage; a marked user who is
// still signed in at launch keeps everything. every supabase factory is a fake (no real client),
// the device network a fake driving the real connectivity binding

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

// the layout opens its storage when it is imported: the shared instance outlives an unmount, as
// the device storage outlives the app
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const mocks = signOutMocks();

const RECENT_SEARCHES = JSON.stringify(['frieren']);
const MARKER_OF_A = { userId: USER_A, clearGuestLibrary: true, deviceWide: true };

// user A signed in with a recent search, one change of the library queued offline, then the marker the
// sign out writes before `signOut()`
const signInWithQueuedChangeThenMark = async () => {
  appStorage.set(RECENT_SEARCHES_STORAGE_KEY, RECENT_SEARCHES);
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
  await mocks.reportSession(USER_A);
  await pressTab('library');
  expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
  await mocks.setDeviceOnline(false);
  await addOneEpisode(ENTRY_A);
  expect(queuedWritesOf(USER_A)).toHaveLength(1);
  deviceMarkers().add(MARKER_OF_A);
};

// the app starts again over the same storage, with the session the auth repository holds
const launch = async () => {
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
  await settle();
};

beforeEach(() => {
  mocks.reset();
  seedDocumentsOfC();
});

afterEach(async () => {
  await mocks.restore();
});

describe('root layout purge-pending marker (A-10)', () => {
  it("purges at the next launch the documents of a user whose sign out was killed after the session ended, another user's kept", async () => {
    await signInWithQueuedChangeThenMark();
    const documentsOfC = documentsOf(USER_C);
    // `signOut()` removed the session, then the app was killed before the purge
    await mocks.reportSession(null);
    await screen.unmount();

    // nothing purged the documents: only the marker tells
    expect(documentsOf(USER_A).copy).toBeDefined();
    expect(queuedWritesOf(USER_A)).toHaveLength(1);
    expect(storedMarkers()).toStrictEqual([MARKER_OF_A]);

    await launch();

    expect(documentsOf(USER_A)).toStrictEqual({ copy: undefined, queue: undefined });
    expect(appStorage.getString(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBeUndefined();
    // signed out at launch: the device-wide steps the marker owed ran too
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBeUndefined();
    expect(documentsOf(USER_C)).toStrictEqual(documentsOfC);
    expect(mocks.auth().signOut).not.toHaveBeenCalled();
  });

  it('keeps the data of a marked user still signed in at launch, and removes the marker', async () => {
    await signInWithQueuedChangeThenMark();
    const documentsOfA = documentsOf(USER_A);
    // killed inside `signOut()`: the session is still on the device
    await screen.unmount();

    await launch();

    expect(storedMarkers()).toStrictEqual([]);
    expect(documentsOf(USER_A)).toStrictEqual(documentsOfA);
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBe(RECENT_SEARCHES);
    await pressTab('library');
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
  });

  it('purges nothing at a launch without a marker after a session that ended by itself', async () => {
    await signInWithQueuedChangeThenMark();
    deviceMarkers().remove(USER_A);
    // a refused refresh for a revoked session, or an expired token: no sign out, no report
    await mocks.reportSession(null);
    await screen.unmount();
    const documentsOfA = documentsOf(USER_A);

    await launch();

    // the queue waits for A's next sign in (ADR-0017)
    expect(documentsOf(USER_A)).toStrictEqual(documentsOfA);
    expect(queuedWritesOf(USER_A)).toHaveLength(1);
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBe(RECENT_SEARCHES);
  });
});
