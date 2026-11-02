import type { LibraryEntry } from '@core/domain/library-entry';
import { LibraryRemoteError } from '@core/errors/library-errors';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent, within } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';
import { STORAGE_INSTANCE_ID } from '@platform/storage';

import { holdNextCall, mergedCopyOf, type Deferred } from '../core/fake-library-repository';
import { entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the guest merge through the composition root (A-04, BR-08, ADR-0016): at sign in, the library tab
// says the titles of the device are being added while the guest library (the real local store
// over the app storage) is merged into the account library of the signed-in user, then shows that
// library; the guest store leaves the device only once the merge succeeded. every supabase factory
// is a fake: no real client

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

jest.mock('@core/repositories/local/library-repository', () => {
  const actual = jest.requireActual<typeof LocalLibrary>(
    '@core/repositories/local/library-repository',
  );
  return { ...actual, createLocalLibraryRepository: jest.fn(actual.createLocalLibraryRepository) };
});

// no http: the library tab reads no catalog data
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test read it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

// read from the mock registry: a static import would load the modules before @jest/globals,
// which the hoisted factories above need
const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
  '@core/repositories/supabase/auth-repository',
);
const supabaseLibraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
  '@core/repositories/supabase/library-repository',
);
const localLibrary = jest.requireMock<typeof LocalLibrary>(
  '@core/repositories/local/library-repository',
);
const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// the options of every guest merge call: the signal of its run, aborted once its session ended
const MERGE_OPTIONS = { signal: expect.any(AbortSignal) };

// a placeholder user id
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const MERGING_TEXT = 'Adding the titles saved on this device to your account…';
const FAILED_TITLE = 'Your library is not ready yet';
const FAILED_TEXT =
  'The titles saved on this device could not be added to your account. They stay on this device: try again to add them and open your library.';

// no cover: the rows need no image host. two guest entries and one account entry, of three media
const noCover = { ...entryOf().media, imageUrl: null };
const GUEST_ENTRY = entryOf({ media: noCover });
const GUEST_OTHER = entryWithMedia(
  { imageUrl: null, title: 'Guest title' },
  { key: keyOf('manga', 2), updatedAt: '2026-02-01T00:00:00.000Z' },
);
const ACCOUNT_ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Account title' },
  { key: keyOf('anime', 21) },
);

const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

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

// the account repository of the nth factory call (0 first) since the test started
const accountOf = (call: number) => {
  const result = createAccountLibrary.mock.results[call];
  if (result?.type !== 'return') {
    throw new Error('the composition root created no account library repository');
  }
  return result.value;
};

// the merge steps settle inside act: a state update of the merge never lands outside of it
const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const reportSession = async (userId: string | null) => {
  await act(async () => {
    supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
    await jest.advanceTimersByTimeAsync(0);
  });
};

// holds the guest merge of the next account repository the composition root gets; `release`
// lets it go on, or fails it with `failure`
const holdNextMerge = () => {
  const holds: Deferred<void>[] = [];
  supabaseLibraryModule.accountSetups.push((repository) => {
    holds.push(holdNextCall(repository, 'mergeGuestEntries'));
  });
  const release = async (failure?: unknown) => {
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
  return { release };
};

const saveGuestEntries = async () => {
  await guestLibrary().save(GUEST_ENTRY);
  await guestLibrary().save(GUEST_OTHER);
};

beforeEach(() => {
  appStorage.clearAll();
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountSetups.length = 0;
  createAccountLibrary.mockClear();
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
});

describe('root layout guest merge (A-04)', () => {
  it('says the titles are being added while the merge runs, then lists the merged account library, the guest store gone', async () => {
    await saveGuestEntries();
    supabaseLibraryModule.accountEntries.set(USER_ID, [ACCOUNT_ENTRY]);
    const merge = holdNextMerge();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    const stored = storedGuestLibrary();

    await reportSession(USER_ID);

    expect(screen.getByTestId('library-merging')).toHaveAccessibleName(MERGING_TEXT);
    // its caption, read once through the spinner
    expect(screen.getByText(MERGING_TEXT, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    // nothing leaves the device before the account confirmed it
    expect(storedGuestLibrary()).toBe(stored);

    await merge.release();
    // the account stamps the time of the merge on what it writes
    const mergedAt = new Date().toISOString();

    expect(await screen.findByTestId(rowOf(ACCOUNT_ENTRY))).toHaveTextContent(
      ACCOUNT_ENTRY.media.title,
      { exact: false },
    );
    expect(screen.getByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(GUEST_OTHER))).toHaveTextContent(GUEST_OTHER.media.title, {
      exact: false,
    });
    expect(screen.queryByTestId('library-merging')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    expect(storedGuestLibrary()).toBeUndefined();
    expect(accountOf(0).stored(GUEST_OTHER.key)).toStrictEqual(mergedCopyOf(GUEST_OTHER, mergedAt));
  });

  it('shows the failure instead of the library with the guest store kept, then merges on Try again', async () => {
    await saveGuestEntries();
    supabaseLibraryModule.accountEntries.set(USER_ID, [ACCOUNT_ENTRY]);
    const merge = holdNextMerge();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    const stored = storedGuestLibrary();
    await reportSession(USER_ID);

    await merge.release(new LibraryRemoteError('network'));
    await settle();

    const failure = await screen.findByTestId('library-merge-error');
    expect(within(failure).getByText(FAILED_TITLE)).toBeOnTheScreen();
    expect(within(failure).getByText(FAILED_TEXT)).toBeOnTheScreen();
    // no library under it: the account library, lacking the guest entries, is never read
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(ACCOUNT_ENTRY))).not.toBeOnTheScreen();
    expect(accountOf(0).list).not.toHaveBeenCalled();
    expect(storedGuestLibrary()).toBe(stored);

    await userEvent.setup().press(within(failure).getByRole('button', { name: 'Try again' }));
    await settle();

    expect(await screen.findByTestId(rowOf(GUEST_OTHER))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(ACCOUNT_ENTRY))).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    expect(storedGuestLibrary()).toBeUndefined();
    expect(accountOf(0).mergeGuestEntries).toHaveBeenCalledTimes(2);
    expect(createAccountLibrary).toHaveBeenCalledTimes(1);
  });

  it('merges at launch with a stored session and empties the guest store, never showing it', async () => {
    await saveGuestEntries();
    const listed = await guestLibrary().list();
    // a session restored from the secure store: reported once the auth provider subscribes
    supabaseAuthModule.sessionSource.emit({ userId: USER_ID });
    const merge = holdNextMerge();

    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    await settle();

    expect(screen.getByTestId('library-merging')).toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(GUEST_ENTRY))).not.toBeOnTheScreen();

    await merge.release();

    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(GUEST_OTHER))).toBeOnTheScreen();
    expect(storedGuestLibrary()).toBeUndefined();
    expect(createAccountLibrary).toHaveBeenCalledTimes(1);
    expect(createAccountLibrary.mock.calls[0]?.[1]).toMatchObject({ userId: USER_ID });
    expect(accountOf(0).mergeGuestEntries.mock.calls).toStrictEqual([[listed, MERGE_OPTIONS]]);
  });
});
