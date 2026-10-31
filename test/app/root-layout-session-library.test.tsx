import type { LibraryEntry } from '@core/domain/library-entry';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';
import { STORAGE_INSTANCE_ID } from '@platform/storage';

import { entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the session library switch (A-03): the composition root (app/_layout.tsx) shows the guest
// library signed out and the account library of the signed-in user, created by the supabase
// library factory over the app's client. every supabase factory is a fake: no real client

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

// the layout opens its storage when it is imported: the shared instance lets the test clear it
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
const { FAKE_SUPABASE_CLIENT } = jest.requireActual<typeof FakeSupabaseModule>(
  '../mobile/fake-supabase-module',
);
const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// a placeholder user id
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// no cover: the rows need no image host. one entry in each library, of different media
const noCover = { ...entryOf().media, imageUrl: null };
const GUEST_ENTRY = entryOf({ media: noCover });
const ACCOUNT_ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Account title' },
  { key: keyOf('anime', 21) },
);

const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

const reportSession = async (userId: string | null) => {
  await act(async () => {
    supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
    await jest.advanceTimersByTimeAsync(0);
  });
};

describe('root layout session library (A-03)', () => {
  it('shows the guest library signed out, the account library signed in, and the guest one after sign out', async () => {
    appStorage.clearAll();
    // the guest repository the layout created when it loaded
    const guest = jest.mocked(localLibrary.createLocalLibraryRepository).mock.results[0]?.value as
      GuestLibraryRepository | undefined;
    await guest?.save(GUEST_ENTRY);
    supabaseLibraryModule.accountEntries.set(USER_ID, [ACCOUNT_ENTRY]);

    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });

    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(createAccountLibrary).not.toHaveBeenCalled();

    await reportSession(USER_ID);

    expect(await screen.findByTestId(rowOf(ACCOUNT_ENTRY))).toHaveTextContent(
      ACCOUNT_ENTRY.media.title,
      { exact: false },
    );
    expect(screen.queryByTestId(rowOf(GUEST_ENTRY))).not.toBeOnTheScreen();
    expect(createAccountLibrary).toHaveBeenCalledTimes(1);
    expect(createAccountLibrary).toHaveBeenCalledWith(FAKE_SUPABASE_CLIENT, {
      userId: USER_ID,
      reporter: expect.any(Object),
    });

    await reportSession(null);

    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(ACCOUNT_ENTRY))).not.toBeOnTheScreen();
  });
});
