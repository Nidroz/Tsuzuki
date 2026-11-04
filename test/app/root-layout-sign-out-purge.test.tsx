import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { PERSIST_THROTTLE_MS, QUERY_CACHE_STORAGE_KEY } from '@core/query/persister';
import { RECENT_SEARCHES_STORAGE_KEY } from '@core/repositories/local/recent-searches-repository';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import {
  FRIEREN,
  pageOf,
  pagedResults,
} from '../../src/features/search/__fixtures__/search-results';
import { createDeferred } from '../core/fake-library-repository';
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
  ENTRY_A_OTHER,
  ENTRY_B,
  favoritesTab,
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
  USER_B,
} from './sign-out-support';

// the sign out purge through the composition root (A-06, FR-25, ADR-0018): once user A confirmed
// a sign out that drops their unsynced changes, nothing of A is readable by the next user B, on
// screen, in the app storage or in the query cache. every supabase factory is a fake (no real
// client), the device network a fake driving the real connectivity binding

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

// no http: the Discover tab gets an empty top list, the Search tab the search set up below
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

// the provider the root layout wraps: the mocked factory always returns the same one
const search = jest.mocked(
  jest
    .requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider(TENRAI_INSTANCE).search,
);
const answersFrieren: CatalogProvider['search'] = () => Promise.resolve(pageOf(FRIEREN));

// the search texts of A: the submitted one becomes a recent search, the other stays typed in the field
const SUBMITTED_TEXT = 'frieren';
const TYPED_TEXT = 'monster';
const UNSYNCED_MESSAGE =
  '2 changes made on this device have not reached your account yet. Signing out deletes them from this device.';

// the queries of the composition root's cache, as text: their keys and their data
const cachedQueries = () =>
  mocks
    .queryClient()
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify([query.queryKey, query.state.data]));

beforeEach(() => {
  mocks.reset();
  search.mockReset();
  search.mockImplementation(answersFrieren);
});

afterEach(async () => {
  await mocks.restore();
});

describe('root layout sign out purge (A-06)', () => {
  it('leaves nothing of A readable by B once A confirmed signing out with unsynced changes', async () => {
    const user = userEvent.setup();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
    await mocks.reportSession(USER_A);
    // the Discover top list is in the persisted cache document
    await settle(PERSIST_THROTTLE_MS);
    expect(appStorage.getString(QUERY_CACHE_STORAGE_KEY)).toBeDefined();

    // a recent search, then a text typed and searched but not submitted
    await pressTab('search');
    await user.type(screen.getByTestId('search-input'), SUBMITTED_TEXT, { submitEditing: true });
    await user.clear(screen.getByTestId('search-input'));
    expect(screen.getByTestId('search-recent')).toHaveTextContent(SUBMITTED_TEXT, {
      exact: false,
    });
    await user.type(screen.getByTestId('search-input'), TYPED_TEXT);
    await settle(SEARCH_DEBOUNCE_MS);
    expect(search).toHaveBeenCalled();
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toContain(SUBMITTED_TEXT);

    // the library of A, then two changes made offline: queued for A
    await pressTab('library');
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
    await mocks.setDeviceOnline(false);
    await addOneEpisode(ENTRY_A);
    await addOneEpisode(ENTRY_A_OTHER);
    expect(queuedWritesOf(USER_A)).toHaveLength(2);
    expect(storedCopyOf(USER_A)).toBeDefined();
    await pressTab('favorites');
    expect(favoritesTab().getByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
    const libraryQueriesOfA = mocks
      .queryClient()
      .getQueryCache()
      .findAll({ queryKey: ['library'] })
      .map(({ queryHash }) => queryHash);
    expect(libraryQueriesOfA).not.toHaveLength(0);
    expect(cachedQueries().join()).toContain(TYPED_TEXT);

    // sign out: the changes are counted and A confirms losing them
    await pressTab('settings');
    await tapAccount(SIGN_OUT_BUTTON);
    expect(screen.getByTestId(UNSYNCED_SHEET)).toHaveTextContent(UNSYNCED_MESSAGE, {
      exact: false,
    });
    expect(mocks.auth().signOut).not.toHaveBeenCalled();
    await tapAccount(`${UNSYNCED_SHEET}-confirm`);

    expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();
    expect(storedCopyOf(USER_A)).toBeUndefined();
    expect(storedQueueOf(USER_A)).toBeUndefined();
    expect(appStorage.getString(RECENT_SEARCHES_STORAGE_KEY)).toBeUndefined();
    expect(appStorage.getString(QUERY_CACHE_STORAGE_KEY)).toBeUndefined();

    // user B signs in online: B's library and favorites only
    await mocks.setDeviceOnline(true);
    await mocks.reportSession(USER_B);
    expect(mocks.accountUserIds()).toStrictEqual([USER_A, USER_B]);
    await pressTab('library');
    expect(await libraryTab().findByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
    expect(libraryTab().queryByTestId(rowOf(ENTRY_A))).not.toBeOnTheScreen();
    expect(libraryTab().queryByTestId(rowOf(ENTRY_A_OTHER))).not.toBeOnTheScreen();
    await pressTab('favorites');
    expect(await favoritesTab().findByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
    expect(favoritesTab().queryByTestId(rowOf(ENTRY_A))).not.toBeOnTheScreen();

    // an empty search field, and no recent search
    await pressTab('search');
    expect(screen.getByTestId('search-input')).toHaveDisplayValue('');
    expect(screen.getByTestId('search-idle')).toBeOnTheScreen();
    expect(screen.queryByTestId('search-recent')).not.toBeOnTheScreen();

    // the cache holds none of A's library queries nor searches, the persisted document neither
    await settle(PERSIST_THROTTLE_MS);
    const cache = mocks.queryClient().getQueryCache();
    for (const queryHash of libraryQueriesOfA) {
      expect(cache.get(queryHash)).toBeUndefined();
    }
    const cached = cachedQueries().join();
    for (const text of [SUBMITTED_TEXT, TYPED_TEXT, ENTRY_A.media.title]) {
      expect(cached).not.toContain(text);
      expect(appStorage.getString(QUERY_CACHE_STORAGE_KEY) ?? '').not.toContain(text);
    }
    expect(cached).toContain(ENTRY_B.media.title);
  });

  it("keeps out of the purged cache the next page of A's search answered while the purge runs", async () => {
    // page 1 of 2 at once; the page 2 prefetch answers once the purge emptied the cache, before
    // the search screen is remounted (a response landing before React commits the new generation)
    const secondPage = createDeferred<Page<MediaSummary>>();
    search.mockImplementation(({ page }) =>
      page === 1 ? Promise.resolve(pagedResults(1, 2)) : secondPage.promise,
    );
    const user = userEvent.setup();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/search' });
    await mocks.reportSession(USER_A);
    await user.type(screen.getByTestId('search-input'), TYPED_TEXT);
    await settle(SEARCH_DEBOUNCE_MS);
    await settle();
    expect(search.mock.calls.map(([{ page }]) => page)).toStrictEqual([1, 2]);
    const client = mocks.queryClient();
    const removeQueries = client.removeQueries.bind(client);
    // the purge removes every query (no filters); a library switch removes its retired scope only
    jest.spyOn(client, 'removeQueries').mockImplementation((filters) => {
      removeQueries(filters);
      if (filters === undefined) {
        secondPage.resolve(pagedResults(2, 2));
      }
    });

    await pressTab('settings');
    await tapAccount(SIGN_OUT_BUTTON);
    await settle();

    expect(client.removeQueries).toHaveBeenCalledWith();
    expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();
    expect(cachedQueries().join()).not.toContain(TYPED_TEXT);
  });
});
