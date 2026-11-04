import type { LibraryEntry } from '@core/domain/library-entry';
import {
  accountLibraryStorageKeys,
  queuedWriteRecord,
  readAccountQueue,
  serializeAccountQueue,
} from '@core/repositories/local/account-library-documents';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent, within } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';
import { STORAGE_INSTANCE_ID } from '@platform/storage';

import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the stuck writes of the account library through the composition root (A-10, ADR-0017 "Stuck
// writes"): a write the database refused stays queued and shown over the server state, never
// sent again by itself; the library tab says so, and a confirmed discard shows the account's
// version. every supabase factory is a fake: no real client

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

// no http: the library tab reads no catalog data
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

// the layout opens its storage when it is imported: the shared instance lets the test seed it
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
const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// a placeholder user id
const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// the entry the account holds, without a cover (no image host needed), and a later change of it
// on the device the database refused
const SERVER_ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Title A' },
  {
    key: keyOf('anime', 1),
    progress: 12,
    createdAt: '2025-11-02T10:00:00.000Z',
    updatedAt: '2025-12-20T10:00:00.000Z',
  },
);
const REFUSED_ENTRY: LibraryEntry = {
  ...SERVER_ENTRY,
  progress: 20,
  updatedAt: '2025-12-21T10:00:00.000Z',
};

const ROW_TEST_ID = 'library-entry-mal-anime-1';
const NOTICE_TEXT = '1 change could not be synced to your account.';

const queueKey = accountLibraryStorageKeys(USER_A).queue;

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const reportSession = async (userId: string | null) => {
  await act(async () => {
    supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
    await jest.advanceTimersByTimeAsync(0);
  });
};

// the account instance of the first factory call since the test started
const firstAccount = () => {
  const result = createAccountLibrary.mock.results[0];
  if (result?.type !== 'return') {
    throw new Error('the composition root created no account library repository');
  }
  return result.value;
};

beforeEach(() => {
  appStorage.clearAll();
  appStorage.set(
    queueKey,
    serializeAccountQueue({
      nextSeq: 2,
      records: [queuedWriteRecord(1, { type: 'save', entry: REFUSED_ENTRY }, { refused: true })],
    }),
  );
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountEntries.set(USER_A, [SERVER_ENTRY]);
  supabaseLibraryModule.accountSetups.length = 0;
  createAccountLibrary.mockClear();
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
});

describe('root layout stuck writes notice (A-10)', () => {
  it('shows a refused write and its notice on the library tab, then the account version once discarded', async () => {
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    await reportSession(USER_A);
    await settle();

    // the refused change is shown over the server state, never sent again by itself
    const row = await screen.findByTestId(ROW_TEST_ID);
    expect(row).toHaveTextContent('20 / 28 episodes', { exact: false });
    expect(screen.getByRole('alert', { name: NOTICE_TEXT })).toBeOnTheScreen();
    expect(firstAccount().replayWrites).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.press(
      screen.getByRole('button', { name: 'Discard the changes that could not be synced' }),
    );
    const sheet = screen.getByTestId('library-sync-discard-sheet');
    await user.press(within(sheet).getByRole('button', { name: 'Discard it' }));
    await settle();

    expect(screen.queryByTestId('library-sync')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-sync-discard-sheet')).not.toBeOnTheScreen();
    expect(readAccountQueue(appStorage.getString(queueKey)).value.records).toStrictEqual([]);
    expect(await screen.findByTestId(ROW_TEST_ID)).toHaveTextContent('12 / 28 episodes', {
      exact: false,
    });
    expect(firstAccount().replayWrites).not.toHaveBeenCalled();
  });
});
