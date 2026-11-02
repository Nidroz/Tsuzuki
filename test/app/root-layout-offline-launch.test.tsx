import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { LibraryQueuedWrite } from '@core/domain/library-sync';
import { createOfflineAccountLibraries } from '@core/repositories/local/account-libraries';
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
import { createMMKV } from 'react-native-mmkv';
import { createStorage, STORAGE_INSTANCE_ID } from '@platform/storage';

import { createFakeAccountLibraryRepository } from '../core/fake-library-repository';
import { entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// the account library across launches of the composition root (A-05, ADR-0017): a write queued
// offline is in the app storage, survives an unmount and a launch, and is replayed once online; a
// launch offline reads the library from the device copy of the last list. the device network is a
// fake driving the real connectivity binding; every supabase factory is a fake: no real client.
// the persisted media detail read offline is proved in src/core/query/offline-queries.test.ts
// and src/core/query/persister.test.ts

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

// the layout opens its storage when it is imported: the shared instance outlives an unmount, as
// the device storage outlives the app
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

// placeholder user ids. USER_C is seen by no test but the one that seeds its queue: the layout's
// factory holds nothing of that user in memory when it launches, as after an app kill
const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

// the account entries, last changed before the test clock; no cover, so the rows need no image host
const lastChanged = {
  createdAt: '2025-11-02T10:00:00.000Z',
  updatedAt: '2025-12-20T10:00:00.000Z',
};
const ENTRY = entryWithMedia(
  { imageUrl: null, title: 'Title A' },
  { key: keyOf('anime', 1), ...lastChanged },
);
const OTHER = entryWithMedia(
  { imageUrl: null, title: 'Title B', format: 'manga', totalUnits: 10 },
  { key: keyOf('manga', 2), ...lastChanged, progress: 3 },
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

// a launch on the library tab, with the session the auth repository holds
const launch = async () => {
  await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
  await settle();
};

const PROGRESS_TEXT = '13 / 28 episodes';

beforeEach(() => {
  appStorage.clearAll();
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountSetups.length = 0;
  createAccountLibrary.mockClear();
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
});

afterEach(() => {
  network.setOnline(true);
  onlineManager.setOnline(true);
});

describe('root layout account library across launches (A-05)', () => {
  it('keeps a write queued offline through an unmount, shows it at the next launch offline, and replays it once online', async () => {
    supabaseLibraryModule.accountEntries.set(USER_A, [ENTRY]);
    await launch();
    await reportSession(USER_A);
    expect(await screen.findByTestId(rowOf(ENTRY))).toBeOnTheScreen();
    await setDeviceOnline(false);
    const user = userEvent.setup();
    await user.press(screen.getByRole('button', { name: `Add one episode, ${ENTRY.media.title}` }));
    await settle(PROGRESS_WRITE_COALESCE_MS);
    const queued = queuedWritesOf(USER_A);
    expect(queued).toStrictEqual([
      { type: 'save', entry: expect.objectContaining({ key: ENTRY.key, progress: 13 }) },
    ]);
    const storedQueue = storedQueueOf(USER_A);

    await screen.unmount();

    expect(storedQueueOf(USER_A)).toBe(storedQueue);

    // the next launch, still offline, with A's stored session
    await launch();

    expect(await screen.findByTestId(rowOf(ENTRY))).toHaveTextContent(PROGRESS_TEXT, {
      exact: false,
    });
    const relaunched = accountOf(1);
    expect(relaunched.list).not.toHaveBeenCalled();
    expect(relaunched.replayWrites).not.toHaveBeenCalled();
    expect(accountOf(0).save).not.toHaveBeenCalled();

    await setDeviceOnline(true);
    await settle();

    expect(relaunched.replayWrites.mock.calls).toStrictEqual([[queued]]);
    expect(relaunched.stored(ENTRY.key)?.progress).toBe(13);
    expect(queuedWritesOf(USER_A)).toStrictEqual([]);
    expect(accountOf(0).replayWrites).not.toHaveBeenCalled();
  });

  it('replays at launch a write queued by an earlier run of the app, from the app storage only', async () => {
    // an earlier run of the app: its own factory over the same app storage, offline
    const earlierRemote = createFakeAccountLibraryRepository([ENTRY]);
    const earlierRun = createOfflineAccountLibraries({
      storage: createStorage(),
      remoteFor: () => earlierRemote,
      isOnline: () => false,
      reporter: { captureError: jest.fn() },
    });
    const changed = { ...ENTRY, progress: 13, updatedAt: new Date().toISOString() };
    await earlierRun(USER_C).save(changed);
    const queued = queuedWritesOf(USER_C);
    expect(queued).toHaveLength(1);
    expect(earlierRemote.save).not.toHaveBeenCalled();
    supabaseLibraryModule.accountEntries.set(USER_C, [ENTRY]);
    supabaseAuthModule.sessionSource.emit({ userId: USER_C });

    await launch();

    const account = accountOf(0);
    expect(account.replayWrites.mock.calls).toStrictEqual([[queued]]);
    expect(account.stored(ENTRY.key)?.progress).toBe(13);
    expect(queuedWritesOf(USER_C)).toStrictEqual([]);
    expect(await screen.findByTestId(rowOf(ENTRY))).toHaveTextContent(PROGRESS_TEXT, {
      exact: false,
    });
  });

  it("shows the signed-in user's entries from the device copy at a launch offline", async () => {
    supabaseLibraryModule.accountEntries.set(USER_A, [ENTRY, OTHER]);
    await launch();
    await reportSession(USER_A);
    expect(await screen.findByTestId(rowOf(ENTRY))).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf(OTHER))).toBeOnTheScreen();
    await screen.unmount();
    network.setOnline(false);

    await launch();

    expect(await screen.findByTestId(rowOf(ENTRY))).toHaveTextContent(ENTRY.media.title, {
      exact: false,
    });
    expect(screen.getByTestId(rowOf(OTHER))).toHaveTextContent(OTHER.media.title, {
      exact: false,
    });
    expect(screen.queryByTestId('library-error')).not.toBeOnTheScreen();
    // read on the device, without a request
    expect(accountOf(1).list).not.toHaveBeenCalled();
    expect(accountOf(1).get).not.toHaveBeenCalled();
  });
});
