import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as AppDevice from '../mobile/app-device';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import {
  addOneEpisode,
  ENTRY_A,
  ENTRY_B,
  offlineQueueMocks,
  queuedWritesOf,
  rowOf,
  settle,
  storedQueueOf,
  USER_A,
  USER_B,
} from './offline-queue-support';

// the account library's write queue through the composition root (A-05, ADR-0017): a change made
// offline is queued for its user only, kept when another user signs in, and replayed to its own
// account at its user's next sign in. the reconnect and foreground triggers are in
// root-layout-offline-queue-triggers.test.tsx. a fake device network drives the real connectivity
// binding; no real supabase client

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

// the layout opens its storage when it is imported: the shared instance lets the test read it,
// with the secure store and the random source of its key (test/mobile/app-device.ts)
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);
jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof AppDevice>('../mobile/app-device').fakeSecureStoreModule(),
);
jest.mock('expo-crypto', () =>
  jest.requireActual<typeof AppDevice>('../mobile/app-device').fakeCryptoModule(),
);

// read from the mock registry: a static import would load them before the hoisted factories
const {
  createAccountLibrary,
  accountOf,
  reportSession,
  setDeviceOnline,
  showAccountLibrary,
  reset,
  restore,
} = offlineQueueMocks();

beforeEach(() => {
  reset();
});

afterEach(() => {
  restore();
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
});
