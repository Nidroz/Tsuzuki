import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';

import { holdNextCall, type Deferred } from '../core/fake-library-repository';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as AppDevice from '../mobile/app-device';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import {
  addOneEpisode,
  ENTRY_A,
  offlineQueueMocks,
  queuedWritesOf,
  settle,
  USER_A,
} from './offline-queue-support';

// the replay triggers of the account library's write queue through the composition root (A-05,
// ADR-0017): the reconnect and foreground triggers of one step send a queued batch once, and a
// return to the foreground while that batch is in flight joins its run. a fake device network
// drives the real connectivity binding, the app state change handlers are captured; no real
// supabase client

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
  supabaseLibraryModule,
  network,
  accountOf,
  setDeviceOnline,
  changeAppState,
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
