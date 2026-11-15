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

import { holdNextCall, type Deferred } from '../core/fake-library-repository';
import { ENTRY_KEY, entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// per R-09 and ADR-0016 "Merge at the entry cap", through the composition root: a guest merge the
// full account library refused shows the account's titles with Remove; a removal from the account
// is the only write, then the merge runs again, and a removed title that was also saved on the
// device comes back with its guest copy. every supabase factory is a fake: no real client

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

// a placeholder user id
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// no cover: the rows need no image host. the guest entry of ENTRY_KEY (12 episodes) and the
// account's copy of it, changed later (3 episodes): BR-08 would keep the account copy
const noCover = { ...entryOf().media, imageUrl: null };
const GUEST_ENTRY = entryOf({ media: noCover });
const ACCOUNT_COPY = entryOf({
  media: noCover,
  progress: 3,
  score: null,
  notes: null,
  updatedAt: '2026-02-20T00:00:00.000Z',
});
const ACCOUNT_ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Account title' },
  { key: keyOf('anime', 21), updatedAt: '2026-02-01T00:00:00.000Z' },
);

const libraryRowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;
const roomRowOf = (entry: LibraryEntry): string =>
  `library-merge-room-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

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

// the account repository of the first factory call since the test started
const account = () => {
  const result = createAccountLibrary.mock.results[0];
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

// signs in with the guest entry on the device, the account holding its copy and another entry,
// and has the account refuse the first merge at its cap (the later merges go on)
const signInRefusedAtCap = async () => {
  await guestLibrary().save(GUEST_ENTRY);
  supabaseLibraryModule.accountEntries.set(USER_ID, [ACCOUNT_COPY, ACCOUNT_ENTRY]);
  const holds: Deferred<void>[] = [];
  supabaseLibraryModule.accountSetups.push((repository) => {
    holds.push(holdNextCall(repository, 'mergeGuestEntries'));
  });
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
  expect(await screen.findByTestId(libraryRowOf(GUEST_ENTRY))).toBeOnTheScreen();
  await act(async () => {
    supabaseAuthModule.sessionSource.emit({ userId: USER_ID });
    await jest.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    holds[0]?.reject(new LibraryRemoteError('library-full'));
    await jest.advanceTimersByTimeAsync(0);
  });
  await settle();
};

beforeEach(() => {
  appStorage.clearAll();
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountSetups.length = 0;
  createAccountLibrary.mockClear();
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
});

describe('root layout guest merge refused at the cap (R-09)', () => {
  it("shows the account's titles with Remove only, the guest store kept", async () => {
    await signInRefusedAtCap();
    const stored = storedGuestLibrary();

    const room = await screen.findByTestId('library-merge-room');
    expect(within(room).getByTestId(roomRowOf(ACCOUNT_COPY))).toBeOnTheScreen();
    expect(within(room).getByTestId(roomRowOf(ACCOUNT_ENTRY))).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    expect(screen.queryByTestId(libraryRowOf(ACCOUNT_ENTRY))).not.toBeOnTheScreen();
    expect(stored).toBeDefined();
    expect(account().save).not.toHaveBeenCalled();
    expect(account().remove).not.toHaveBeenCalled();
  });

  it('removes a title from the account, merges again, and the guest copy of that title comes back', async () => {
    await signInRefusedAtCap();
    const user = userEvent.setup();
    await screen.findByTestId('library-merge-room');

    await user.press(screen.getByTestId(`${roomRowOf(ACCOUNT_COPY)}-remove`));
    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));
    await settle();

    expect(account().remove.mock.calls).toStrictEqual([[ENTRY_KEY]]);
    expect(account().mergeGuestEntries).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId(libraryRowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(libraryRowOf(ACCOUNT_ENTRY))).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-room')).not.toBeOnTheScreen();
    // the guest copy, its progress and notes kept, then removed from the device
    expect(account().stored(ENTRY_KEY)).toMatchObject({
      progress: GUEST_ENTRY.progress,
      notes: GUEST_ENTRY.notes,
    });
    expect(storedGuestLibrary()).toBeUndefined();
    expect(account().save).not.toHaveBeenCalled();
  });
});
