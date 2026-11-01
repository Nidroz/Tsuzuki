import type { LibraryEntry } from '@core/domain/library-entry';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';
import { STORAGE_INSTANCE_ID } from '@platform/storage';

import { holdNextCall, type Deferred } from '../core/fake-library-repository';
import { entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the guest merge through the composition root across session changes (A-04, BR-08, ADR-0016): a
// merge whose session ended leaves the guest store (the real local store over the app storage)
// untouched, the guest entries go to the account library created for the signed-in user only,
// and a `+1` still in its coalescing window at sign in reaches the guest store before the merge
// reads it. every supabase factory is a fake: no real client

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

// placeholder user ids
const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// no cover: the rows need no image host. two guest entries, of two media
const noCover = { ...entryOf().media, imageUrl: null };
const GUEST_ENTRY = entryOf({ media: noCover });
const GUEST_OTHER = entryWithMedia(
  { imageUrl: null, title: 'Guest title' },
  { key: keyOf('manga', 2), updatedAt: '2026-02-01T00:00:00.000Z' },
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
// lets it go on
const holdNextMerge = () => {
  const holds: Deferred<void>[] = [];
  supabaseLibraryModule.accountSetups.push((repository) => {
    holds.push(holdNextCall(repository, 'mergeGuestEntries'));
  });
  const release = async () => {
    const [held] = holds;
    if (held === undefined) {
      throw new Error('no account library repository was created');
    }
    await act(async () => {
      held.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  return { release };
};

beforeEach(() => {
  appStorage.clearAll();
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountSetups.length = 0;
  createAccountLibrary.mockClear();
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
});

describe('root layout guest merge across sessions (A-04)', () => {
  it('shows the guest library at once on sign out during the merge, and never removes its entries', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    await guestLibrary().save(GUEST_OTHER);
    const merge = holdNextMerge();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    const stored = storedGuestLibrary();
    await reportSession(USER_A);
    expect(screen.getByTestId('library-merging')).toBeOnTheScreen();

    await reportSession(null);

    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merging')).not.toBeOnTheScreen();

    // the merge of the ended session concludes: it changes and removes nothing
    await merge.release();
    await settle();

    expect(storedGuestLibrary()).toBe(stored);
    expect(screen.getByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(GUEST_OTHER))).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merging')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
  });

  it('merges the guest entries into the account library of the signed-in user only, once per sign in', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();

    await reportSession(USER_A);
    await settle();
    // a token refresh keeps the account library and merges nothing more
    await reportSession(USER_A);
    await reportSession(null);
    expect(await screen.findByTestId('library-empty')).toBeOnTheScreen();
    // used as a guest again, then another user signs in
    await guestLibrary().save(GUEST_OTHER);
    await reportSession(USER_B);
    await settle();

    expect(await screen.findByTestId(rowOf(GUEST_OTHER))).toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(GUEST_ENTRY))).not.toBeOnTheScreen();
    expect(createAccountLibrary.mock.calls.map(([, { userId }]) => userId)).toStrictEqual([
      USER_A,
      USER_B,
    ]);
    const [accountA, accountB] = [accountOf(0), accountOf(1)];
    expect(accountA.mergeGuestEntries.mock.calls).toStrictEqual([[[GUEST_ENTRY]]]);
    expect(accountB.mergeGuestEntries.mock.calls).toStrictEqual([[[GUEST_OTHER]]]);
    expect(accountA.stored(GUEST_OTHER.key)).toBeNull();
    expect(accountB.stored(GUEST_ENTRY.key)).toBeNull();
    expect(storedGuestLibrary()).toBeUndefined();
  });

  it('keeps a guest entry changed while the merge ran, and merges it at the next sign in', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    await guestLibrary().save(GUEST_OTHER);
    const merge = holdNextMerge();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    await reportSession(USER_A);

    // a write the merge did not list
    const changed = await guestLibrary().save({
      ...GUEST_OTHER,
      progress: GUEST_OTHER.progress + 1,
      updatedAt: '2026-02-15T00:00:00.000Z',
    });
    await merge.release();
    await settle();

    // only the entry the account got as it is on the device leaves it
    await expect(guestLibrary().list()).resolves.toStrictEqual([changed]);
    expect(accountOf(0).stored(GUEST_OTHER.key)).toStrictEqual(GUEST_OTHER);

    await reportSession(null);
    await reportSession(USER_A);
    await settle();

    expect(accountOf(1).mergeGuestEntries.mock.calls).toStrictEqual([[[changed]]]);
    expect(storedGuestLibrary()).toBeUndefined();
  });

  it('writes a `+1` still in its coalescing window to the guest store first, then merges it', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    const user = userEvent.setup();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Add one episode, Sousou no Frieren' }));

    // not written yet: the sign in lands inside the coalescing window
    await expect(guestLibrary().get(GUEST_ENTRY.key)).resolves.toMatchObject({
      progress: GUEST_ENTRY.progress,
    });

    await reportSession(USER_A);
    await settle();

    const merged = accountOf(0).mergeGuestEntries.mock.calls[0]?.[0];
    expect(merged?.map((entry) => entry.progress)).toStrictEqual([GUEST_ENTRY.progress + 1]);
    expect(accountOf(0).stored(GUEST_ENTRY.key)?.progress).toBe(GUEST_ENTRY.progress + 1);
    expect(storedGuestLibrary()).toBeUndefined();
    // the account library shows the merged progress: 12 + 1 of 28
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
  });
});
