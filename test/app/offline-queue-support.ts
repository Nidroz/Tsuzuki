// shared steps of the route tests of the account library's write queue (A-05, ADR-0017): two
// placeholder users with one account entry each, the shared app storage, the app state's change
// handlers, and the mocked supabase and network modules read from the mock registry (each test
// file declares the mocks)
import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { LibraryQueuedWrite } from '@core/domain/library-sync';
import {
  accountLibraryStorageKeys,
  readAccountQueue,
} from '@core/repositories/local/account-library-documents';
import { expect, jest } from '@jest/globals';
import { APP_STORAGE_INSTANCE_ID } from '@platform/app-storage-instance';
import { onlineManager } from '@tanstack/react-query';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES } from './app-routes';

// placeholder user ids
export const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// one entry per account, of different media, changed before the test clock; no cover (no host)
const lastChanged = {
  createdAt: '2025-11-02T10:00:00.000Z',
  updatedAt: '2025-12-20T10:00:00.000Z',
};
export const ENTRY_A = entryWithMedia(
  { imageUrl: null, title: 'Title A' },
  { key: keyOf('anime', 1), ...lastChanged },
);
export const ENTRY_B = entryWithMedia(
  { imageUrl: null, title: 'Title B' },
  { key: keyOf('anime', 2), ...lastChanged },
);

export const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

/** the app storage the layout opened: the encrypted instance, shared in memory by id */
const appStorage = createMMKV({ id: APP_STORAGE_INSTANCE_ID });

export const storedQueueOf = (userId: string): string | undefined =>
  appStorage.getString(accountLibraryStorageKeys(userId).queue);

export const queuedWritesOf = (userId: string): readonly LibraryQueuedWrite[] =>
  readAccountQueue(storedQueueOf(userId)).value.records.map(({ write }) => write);

export const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

/** a `+1` on the row of `entry`, written once its coalescing window passed */
export const addOneEpisode = async (entry: LibraryEntry) => {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: `Add one episode, ${entry.media.title}` }));
  await settle(PROGRESS_WRITE_COALESCE_MS);
};

// the react native jest preset mocks AppState: the current state is set (and restored), and the
// change handlers subscribed captured (the auth refresh, the library writer and the replay follow it)
const presetCurrentState: unknown = AppState.currentState;
const appStateHandlers = new Set<(state: AppStateStatus) => void>();

/**
 * the mocks of a test file that declares jest.mock for the supabase client, auth and library
 * modules (test/mobile/fake-supabase-module.ts) and expo-network (fake-network-module.ts). call it
 * at module level, after the jest.mock calls
 */
export const offlineQueueMocks = () => {
  const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
    '@core/repositories/supabase/auth-repository',
  );
  const supabaseLibraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
    '@core/repositories/supabase/library-repository',
  );
  const { network } = jest.requireMock<FakeNetworkModule.FakeNetworkModule>('expo-network');
  const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

  const reportSession = async (userId: string | null) => {
    await act(async () => {
      supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
      await jest.advanceTimersByTimeAsync(0);
    });
  };

  return {
    supabaseLibraryModule,
    network,
    createAccountLibrary,
    reportSession,
    /** the account repository of the nth factory call (0 first) since the test started */
    accountOf: (call: number) => {
      const result = createAccountLibrary.mock.results[call];
      if (result?.type !== 'return') {
        throw new Error('the composition root created no account library repository');
      }
      return result.value;
    },
    setDeviceOnline: async (online: boolean) => {
      await act(async () => {
        network.setOnline(online);
        await jest.advanceTimersByTimeAsync(0);
      });
    },
    /** calls every app state change handler subscribed now with `state` */
    changeAppState: (state: AppStateStatus): void => {
      for (const handler of [...appStateHandlers]) {
        handler(state);
      }
    },
    /** the library tab with `userId` signed in and its account listed online */
    showAccountLibrary: async (userId: string, entry: LibraryEntry) => {
      await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
      await reportSession(userId);
      expect(await screen.findByTestId(rowOf(entry))).toBeOnTheScreen();
    },
    /** for beforeEach: empty storage, A and B's accounts, signed out, the app active */
    reset: () => {
      appStorage.clearAll();
      supabaseLibraryModule.accountEntries.clear();
      supabaseLibraryModule.accountEntries.set(USER_A, [ENTRY_A]);
      supabaseLibraryModule.accountEntries.set(USER_B, [ENTRY_B]);
      supabaseLibraryModule.accountSetups.length = 0;
      createAccountLibrary.mockClear();
      // no listener between tests: this sets the session the next mount reports, signed out
      supabaseAuthModule.sessionSource.emit(null);
      Reflect.set(AppState, 'currentState', 'active');
      appStateHandlers.clear();
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
        const subscribed = (state: AppStateStatus): void => {
          handler(state);
        };
        appStateHandlers.add(subscribed);
        return {
          remove: () => {
            appStateHandlers.delete(subscribed);
          },
        };
      });
    },
    /** for afterEach: the device and the onlineManager online, the preset's app state */
    restore: () => {
      network.setOnline(true);
      onlineManager.setOnline(true);
      Reflect.set(AppState, 'currentState', presetCurrentState);
    },
  };
};
