import type { LibraryEntry } from '@core/domain/library-entry';
import { LibraryRemoteError } from '@core/errors/library-errors';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import { holdNextCall, type Deferred } from '../core/fake-library-repository';
import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as RecordingQueryClient from '../mobile/recording-query-client';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import {
  appStorage,
  libraryTab,
  pressTab,
  rowOf,
  SIGN_OUT_BUTTON,
  signOutMocks,
  tapAccount,
  USER_A,
} from './sign-out-support';

// the guest library at sign out (A-06, BR-08, ADR-0018): kept while the guest merge has not
// concluded (failed here), so it shows again as the guest library once signed out; cleared once
// the merge concluded. the guest library is the real local store over the app storage; every
// supabase factory is a fake (no real client)

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

jest.mock('@core/repositories/local/library-repository', () => {
  const actual = jest.requireActual<typeof LocalLibrary>(
    '@core/repositories/local/library-repository',
  );
  return { ...actual, createLocalLibraryRepository: jest.fn(actual.createLocalLibraryRepository) };
});

// no http: the library and settings tabs read no catalog data
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
const supabaseLibraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
  '@core/repositories/supabase/library-repository',
);
const localLibrary = jest.requireMock<typeof LocalLibrary>(
  '@core/repositories/local/library-repository',
);

// a guest entry saved on the device before the sign in, no cover; then changed while it merges
const GUEST_ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Guest title' },
  {
    key: keyOf('manga', 5),
    createdAt: '2025-11-02T10:00:00.000Z',
    updatedAt: '2025-12-20T10:00:00.000Z',
  },
);
const GUEST_ENTRY_CHANGED: LibraryEntry = {
  ...GUEST_ENTRY,
  progress: GUEST_ENTRY.progress + 1,
  updatedAt: '2025-12-21T10:00:00.000Z',
};

// the guest repository the layout created when it loaded
const guestLibrary = (): GuestLibraryRepository => {
  const created = jest.mocked(localLibrary.createLocalLibraryRepository).mock.results[0];
  if (created?.type !== 'return') {
    throw new Error('the composition root created no guest library repository');
  }
  return created.value;
};

const storedGuestLibrary = (): string | undefined =>
  appStorage.getString(localLibrary.GUEST_LIBRARY_STORAGE_KEY);

// holds the guest merge of the next account repository; `release` lets it go on, or fails it
const holdNextMerge = () => {
  const holds: Deferred<void>[] = [];
  supabaseLibraryModule.accountSetups.push((repository) => {
    holds.push(holdNextCall(repository, 'mergeGuestEntries'));
  });
  return async (failure?: unknown) => {
    const [held] = holds;
    if (held === undefined) {
      throw new Error('no account library repository was created');
    }
    await act(async () => {
      if (failure === undefined) {
        held.resolve();
      } else {
        held.reject(failure);
      }
      await jest.advanceTimersByTimeAsync(0);
    });
  };
};

// the guest library listed signed out, then A signs in and the merge is held
const signInWithGuestEntry = async () => {
  await guestLibrary().save(GUEST_ENTRY);
  const releaseMerge = holdNextMerge();
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
  expect(await libraryTab().findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
  await mocks.reportSession(USER_A);
  expect(libraryTab().getByTestId('library-merging')).toBeOnTheScreen();
  return releaseMerge;
};

const signOut = async () => {
  await pressTab('settings');
  await tapAccount(SIGN_OUT_BUTTON);
  expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();
  await pressTab('library');
};

beforeEach(() => {
  mocks.reset();
});

afterEach(async () => {
  await mocks.restore();
});

describe('root layout sign out and the guest library (A-06)', () => {
  it('keeps the guest library after a failed merge, shown again once signed out', async () => {
    const releaseMerge = await signInWithGuestEntry();
    await releaseMerge(new LibraryRemoteError('network'));
    expect(libraryTab().getByTestId('library-merge-error')).toBeOnTheScreen();
    const stored = storedGuestLibrary();
    expect(stored).toBeDefined();

    await signOut();

    expect(storedGuestLibrary()).toBe(stored);
    expect(await libraryTab().findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(libraryTab().queryByTestId('library-merge-error')).not.toBeOnTheScreen();
  });

  it('keeps the guest library at a sign out while the merge runs, a merge failing later included', async () => {
    const releaseMerge = await signInWithGuestEntry();
    const stored = storedGuestLibrary();

    await signOut();
    await releaseMerge(new LibraryRemoteError('network'));

    expect(storedGuestLibrary()).toBe(stored);
    expect(await libraryTab().findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(libraryTab().queryByTestId('library-merging')).not.toBeOnTheScreen();
  });

  it('clears the guest library once the merge concluded, an entry it left included', async () => {
    const releaseMerge = await signInWithGuestEntry();
    // changed while the merge runs: the merge removes only the guest entries it sent unchanged
    await guestLibrary().save(GUEST_ENTRY_CHANGED);
    await releaseMerge();
    expect(await libraryTab().findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(await guestLibrary().list()).toStrictEqual([GUEST_ENTRY_CHANGED]);

    await signOut();

    expect(await guestLibrary().list()).toStrictEqual([]);
    expect(await libraryTab().findByTestId('library-empty')).toBeOnTheScreen();
    expect(libraryTab().queryByTestId(rowOf(GUEST_ENTRY))).not.toBeOnTheScreen();
  });
});
