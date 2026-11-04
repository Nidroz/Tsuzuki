// shared steps of the sign out route tests (A-06, FR-25, ADR-0018): two placeholder users with
// their account entries, the shared app storage, the mocked supabase, network and query client
// modules read lazily from the mock registry (each test file declares the mocks), and the taps
import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { PERSIST_THROTTLE_MS } from '@core/query/persister';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { LibraryQueuedWrite } from '@core/domain/library-sync';
import type { DevicePurgeMarker } from '@core/repositories/device-purge-marker-repository';
import {
  accountLibraryStorageKeys,
  readAccountQueue,
} from '@core/repositories/local/account-library-documents';
import { createLocalDevicePurgeMarkerRepository } from '@core/repositories/local/device-purge-marker-repository';
import { jest } from '@jest/globals';
import { createStorage, STORAGE_INSTANCE_ID } from '@platform/storage';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';

import type { FakeAuthRepository } from '../core/fake-auth-repository';
import type { FakeAccountLibraryRepository } from '../core/fake-library-repository';
import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as RecordingQueryClient from '../mobile/recording-query-client';

// placeholder user ids
export const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
// a user no test signs in: their documents are stand-ins, never read
export const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

// last changed before the test clock; no cover, so the rows need no image host
const lastChanged = {
  createdAt: '2025-11-02T10:00:00.000Z',
  updatedAt: '2025-12-20T10:00:00.000Z',
};
/** the favorite and the other entry of A, and the favorite of B, of three media */
export const ENTRY_A = entryWithMedia(
  { imageUrl: null, title: 'Title A' },
  { key: keyOf('anime', 1), isFavorite: true, ...lastChanged },
);
export const ENTRY_A_OTHER = entryWithMedia(
  { imageUrl: null, title: 'Title A other' },
  { key: keyOf('anime', 3), ...lastChanged },
);
export const ENTRY_B = entryWithMedia(
  { imageUrl: null, title: 'Title B' },
  { key: keyOf('anime', 2), isFavorite: true, ...lastChanged },
);

export const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

/** the app storage the layout opened (the shared in-memory instance) */
export const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

export const storedCopyOf = (userId: string): string | undefined =>
  appStorage.getString(accountLibraryStorageKeys(userId).copy);
export const storedQueueOf = (userId: string): string | undefined =>
  appStorage.getString(accountLibraryStorageKeys(userId).queue);
export const queuedWritesOf = (userId: string): readonly LibraryQueuedWrite[] =>
  readAccountQueue(storedQueueOf(userId)).value.records.map(({ write }) => write);

/** the device copy and write queue of `userId`, as stored */
export const documentsOf = (userId: string) => ({
  copy: storedCopyOf(userId),
  queue: storedQueueOf(userId),
});

/** stand-in documents of USER_C, whom no test signs in: a purge of another user keeps them */
export const seedDocumentsOfC = (): void => {
  const keys = accountLibraryStorageKeys(USER_C);
  appStorage.set(keys.copy, 'device copy of C');
  appStorage.set(keys.queue, 'write queue of C');
};

/** the purge-pending markers of the app storage, as a sign out or the next launch reads them */
export const deviceMarkers = () =>
  createLocalDevicePurgeMarkerRepository(createStorage(), {
    reporter: { captureError: jest.fn() },
  });

/** the markers in the app storage now */
export const storedMarkers = (): readonly DevicePurgeMarker[] => deviceMarkers().list();

export const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

export const libraryTab = () => within(screen.getByTestId('library-screen'));
export const favoritesTab = () => within(screen.getByTestId('favorites-screen'));

export const pressTab = async (tab: 'search' | 'library' | 'favorites' | 'settings') => {
  const user = userEvent.setup();
  await user.press(screen.getByTestId(`tab-${tab}`));
  await settle();
};

/** a `+1` on the library row of `entry`, written once its coalescing window passed */
export const addOneEpisode = async (entry: LibraryEntry) => {
  const user = userEvent.setup();
  await user.press(
    libraryTab().getByRole('button', { name: `Add one episode, ${entry.media.title}` }),
  );
  await settle(PROGRESS_WRITE_COALESCE_MS);
};

export const SIGN_OUT_BUTTON = 'settings-account-sign-out';
export const UNSYNCED_SHEET = 'settings-account-unsynced';

/** taps a button of the settings account section or of its unsynced sheet, then settles */
export const tapAccount = async (testID: string) => {
  const user = userEvent.setup();
  await user.press(screen.getByTestId(testID));
  await settle();
};

/** the account library mocks, all of a test file: the fakes keep the calls until cleared */
export interface SignOutMocks {
  readonly auth: () => FakeAuthRepository;
  /** the account repository of the nth factory call (0 first) since the test started */
  readonly accountOf: (call: number) => FakeAccountLibraryRepository;
  readonly accountUserIds: () => readonly string[];
  /** sets up the next account repository the composition root gets, before it gets it */
  readonly setUpNextAccount: (setup: FakeSupabaseModule.FakeAccountSetup) => void;
  readonly queryClient: () => QueryClient;
  readonly reportSession: (userId: string | null) => Promise<void>;
  readonly setDeviceOnline: (online: boolean) => Promise<void>;
  /** for beforeEach: empty storage, A and B's accounts, signed out, a sign out that ends it */
  readonly reset: () => void;
  /**
   * for afterEach: the throttled save of the query cache run, then the device and the
   * onlineManager online again. the persister lives as long as the test file and schedules a save
   * only when none is pending: a save left pending when the next test reinstalls the fake timers
   * would never run, and no later save would be scheduled
   */
  readonly restore: () => Promise<void>;
}

/**
 * the mocks of a test file that declares jest.mock for the supabase client, auth and library
 * modules (test/mobile/fake-supabase-module.ts), expo-network (fake-network-module.ts) and the query
 * client (recording-query-client.ts). call it at module level, after the jest.mock calls
 */
export const signOutMocks = (): SignOutMocks => {
  const authModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
    '@core/repositories/supabase/auth-repository',
  );
  const libraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
    '@core/repositories/supabase/library-repository',
  );
  const { network } = jest.requireMock<FakeNetworkModule.FakeNetworkModule>('expo-network');
  const queryClientModule = jest.requireMock<RecordingQueryClient.RecordingQueryClientModule>(
    '@core/query/query-client',
  );
  const { appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
    '../mobile/fake-supabase-module',
  );
  const { lastQueryClientOf } = jest.requireActual<typeof RecordingQueryClient>(
    '../mobile/recording-query-client',
  );
  const createAccount = libraryModule.createSupabaseLibraryRepository;
  const auth = () => appAuthRepositoryOf(authModule);

  return {
    auth,
    accountOf: (call) => {
      const result = createAccount.mock.results[call];
      if (result?.type !== 'return') {
        throw new Error('the composition root created no account library repository');
      }
      return result.value;
    },
    accountUserIds: () => createAccount.mock.calls.map(([, { userId }]) => userId),
    setUpNextAccount: (setup) => {
      libraryModule.accountSetups.push(setup);
    },
    queryClient: () => lastQueryClientOf(queryClientModule),
    reportSession: async (userId) => {
      await act(async () => {
        authModule.sessionSource.emit(userId === null ? null : { userId });
        await jest.advanceTimersByTimeAsync(0);
      });
    },
    setDeviceOnline: async (online) => {
      await act(async () => {
        network.setOnline(online);
        await jest.advanceTimersByTimeAsync(0);
      });
    },
    reset: () => {
      appStorage.clearAll();
      libraryModule.accountEntries.clear();
      libraryModule.accountEntries.set(USER_A, [ENTRY_A, ENTRY_A_OTHER]);
      libraryModule.accountEntries.set(USER_B, [ENTRY_B]);
      libraryModule.accountSetups.length = 0;
      createAccount.mockClear();
      // no listener between tests: this sets the session the next mount reports, signed out
      authModule.sessionSource.emit(null);
      // the local sign out ends the session, as supabase-js does
      auth().signOut.mockReset();
      auth().signOut.mockImplementation(() => {
        authModule.sessionSource.emit(null);
        return Promise.resolve();
      });
    },
    restore: async () => {
      await settle(PERSIST_THROTTLE_MS);
      network.setOnline(true);
      onlineManager.setOnline(true);
    },
  };
};
