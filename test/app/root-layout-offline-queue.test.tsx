import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { LibraryQueuedWrite } from '@core/domain/library-sync';
import {
  accountLibraryStorageKeys,
  readAccountQueue,
} from '@core/repositories/local/account-library-documents';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { AppState, type AppStateStatus } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { STORAGE_INSTANCE_ID } from '@platform/storage';

import { holdNextCall, type Deferred } from '../core/fake-library-repository';
import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the write queue of the account library through the composition root (A-05, ADR-0017): a change
// made offline is queued for its user only, stays on the device when another user signs in, and
// is replayed to its own account at its user's next sign in; the reconnect and foreground
// triggers of one step send each batch once. the device network is a fake driving the real
// connectivity binding; every supabase factory is a fake: no real client

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
const { network } = jest.requireMock<FakeNetworkModule.FakeNetworkModule>('expo-network');
const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// placeholder user ids
const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// one entry per account, of different media, last changed before the test clock; no cover, so
// the rows need no image host
const lastChanged = {
  createdAt: '2025-11-02T10:00:00.000Z',
  updatedAt: '2025-12-20T10:00:00.000Z',
};
const ENTRY_A = entryWithMedia(
  { imageUrl: null, title: 'Title A' },
  { key: keyOf('anime', 1), ...lastChanged },
);
const ENTRY_B = entryWithMedia(
  { imageUrl: null, title: 'Title B' },
  { key: keyOf('anime', 2), ...lastChanged },
);

const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

// the account repository of the nth factory call (0 first) since the test started
const accountOf = (call: number) => {
  const result = createAccountLibrary.mock.results[call];
  if (result?.type !== 'return') {
    throw new Error('the composition root created no account library repository');
  }
  return result.value;
};

const storedQueueOf = (userId: string): string | undefined =>
  appStorage.getString(accountLibraryStorageKeys(userId).queue);

const queuedWritesOf = (userId: string): readonly LibraryQueuedWrite[] =>
  readAccountQueue(storedQueueOf(userId)).value.records.map(({ write }) => write);

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

const setDeviceOnline = async (online: boolean) => {
  await act(async () => {
    network.setOnline(online);
    await jest.advanceTimersByTimeAsync(0);
  });
};

// the react native jest preset mocks AppState: the current state is set (and restored), and the
// change handlers subscribed captured (the auth refresh, the library writer and the replay follow it)
const presetCurrentState: unknown = AppState.currentState;
const appStateHandlers = new Set<(state: AppStateStatus) => void>();
const changeAppState = (state: AppStateStatus): void => {
  for (const handler of [...appStateHandlers]) {
    handler(state);
  }
};

// a `+1` on the row of `entry`, written once its coalescing window passed
const addOneEpisode = async (entry: LibraryEntry) => {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: `Add one episode, ${entry.media.title}` }));
  await settle(PROGRESS_WRITE_COALESCE_MS);
};

// the library tab with `userId` signed in and its account listed online
const showAccountLibrary = async (userId: string, entry: LibraryEntry) => {
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
  await reportSession(userId);
  expect(await screen.findByTestId(rowOf(entry))).toBeOnTheScreen();
};

beforeEach(() => {
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
});

afterEach(() => {
  network.setOnline(true);
  onlineManager.setOnline(true);
  Reflect.set(AppState, 'currentState', presetCurrentState);
});

describe('root layout account library write queue (A-05)', () => {
  it("never sends a user's queued write for another user, keeps it on the device, and replays it at that user's next sign in", async () => {
    await showAccountLibrary(USER_A, ENTRY_A);
    await setDeviceOnline(false);

    await addOneEpisode(ENTRY_A);

    // queued for A, shown at once, and nothing sent to A's account
    const accountA = accountOf(0);
    expect(screen.getByTestId(rowOf(ENTRY_A))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
    const queued = queuedWritesOf(USER_A);
    expect(queued).toStrictEqual([
      { type: 'save', entry: expect.objectContaining({ key: ENTRY_A.key, progress: 13 }) },
    ]);
    expect(accountA.save).not.toHaveBeenCalled();
    expect(accountA.replayWrites).not.toHaveBeenCalled();
    const storedQueueA = storedQueueOf(USER_A);

    // user A signs out, B signs in offline (no device copy of B yet: the error state), then the
    // device reconnects and the library is read again by itself (refetchOnReconnect)
    await reportSession(null);
    await reportSession(USER_B);
    expect(await screen.findByTestId('library-error')).toBeOnTheScreen();
    await setDeviceOnline(true);
    await settle();

    const accountB = accountOf(1);
    expect(createAccountLibrary.mock.calls.map(([, { userId }]) => userId)).toStrictEqual([
      USER_A,
      USER_B,
    ]);
    expect(await screen.findByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(ENTRY_A))).not.toBeOnTheScreen();
    // nothing of A's reaches B's account, nor A's account while B is signed in
    expect(accountB.replayWrites).not.toHaveBeenCalled();
    expect(accountB.save).not.toHaveBeenCalled();
    expect(accountB.remove).not.toHaveBeenCalled();
    expect(accountB.stored(ENTRY_A.key)).toBeNull();
    expect(accountA.replayWrites).not.toHaveBeenCalled();
    expect(accountA.save).not.toHaveBeenCalled();
    // the queue of A stays on the device as it was (purging it is A-06's), B has none
    expect(storedQueueOf(USER_A)).toBe(storedQueueA);
    expect(queuedWritesOf(USER_B)).toStrictEqual([]);

    // user A signs in again, online: the write reaches A's account and leaves the queue
    await reportSession(null);
    await reportSession(USER_A);
    await settle();

    const accountAgain = accountOf(2);
    expect(accountAgain.replayWrites.mock.calls).toStrictEqual([[queued]]);
    expect(accountAgain.stored(ENTRY_A.key)?.progress).toBe(13);
    expect(queuedWritesOf(USER_A)).toStrictEqual([]);
    expect(accountB.replayWrites).not.toHaveBeenCalled();
    expect(await screen.findByTestId(rowOf(ENTRY_A))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
  });

  it('sends a queued batch once when the device reconnects as the app returns to the foreground', async () => {
    const holds: Deferred<void>[] = [];
    supabaseLibraryModule.accountSetups.push((repository) => {
      holds.push(holdNextCall(repository, 'replayWrites'));
    });
    await showAccountLibrary(USER_A, ENTRY_A);
    await setDeviceOnline(false);
    await addOneEpisode(ENTRY_A);
    const queued = queuedWritesOf(USER_A);
    await act(() => {
      changeAppState('background');
    });
    const account = accountOf(0);
    expect(account.replayWrites).not.toHaveBeenCalled();

    // both triggers in one step
    await act(async () => {
      network.setOnline(true);
      changeAppState('active');
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(account.replayWrites.mock.calls).toStrictEqual([[queued]]);

    // another return to the foreground while that batch is in flight joins its run
    await act(() => {
      changeAppState('background');
    });
    await act(async () => {
      changeAppState('active');
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(account.replayWrites).toHaveBeenCalledTimes(1);

    await act(async () => {
      holds[0]?.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    await settle();

    expect(account.replayWrites).toHaveBeenCalledTimes(1);
    expect(account.save).not.toHaveBeenCalled();
    expect(account.stored(ENTRY_A.key)?.progress).toBe(13);
    expect(queuedWritesOf(USER_A)).toStrictEqual([]);
  });
});
