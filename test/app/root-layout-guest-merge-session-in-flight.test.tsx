import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import { holdNextCall, mergedCopyOf, type Deferred } from '../core/fake-library-repository';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as AppDevice from '../mobile/app-device';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import {
  GUEST_ENTRY,
  GUEST_OTHER,
  guestMergeSessionMocks,
  MERGE_OPTIONS,
  rowOf,
  settle,
  USER_A,
} from './guest-merge-session-support';

// a guest merge in flight across session changes (A-04, BR-08, ADR-0016): a merge whose session
// ended leaves the guest store (the real local store) untouched, and an entry changed during the
// merge stays on the device and replaces the merged copy at the next merge. every supabase
// factory is a fake (its merge keeps the guest times, capped)

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
const { supabaseLibraryModule, guestLibrary, storedGuestLibrary, accountOf, reportSession, reset } =
  guestMergeSessionMocks();

// between two steps on the device: a minute of fake time
const DEVICE_STEP_MS = 60_000;

// holds the guest merge of the next account repository the layout gets; `release` lets it go on
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
  reset();
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

  it('keeps a guest entry changed while the merge ran, and its next merge replaces the merged copy with that newer change (BR-08)', async () => {
    // the guest entries, last changed on the device before the sign in
    const lastChanged = {
      createdAt: '2025-11-02T10:00:00.000Z',
      updatedAt: '2025-12-20T10:00:00.000Z',
    };
    const first = { ...GUEST_ENTRY, ...lastChanged };
    const other = { ...GUEST_OTHER, ...lastChanged };
    await guestLibrary().save(first);
    await guestLibrary().save(other);
    const merge = holdNextMerge();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(first))).toBeOnTheScreen();
    await reportSession(USER_A);
    // the merge listed the guest store, its write is held
    expect(accountOf(0).mergeGuestEntries.mock.calls).toStrictEqual([
      [[first, other], MERGE_OPTIONS],
    ]);

    // a change on the device after the listing, before the merge write, at the device's time
    await settle(DEVICE_STEP_MS);
    const changed = await guestLibrary().save({
      ...other,
      progress: other.progress + 1,
      updatedAt: new Date().toISOString(),
    });
    await settle(DEVICE_STEP_MS);
    await merge.release();
    const mergedAt = new Date().toISOString();
    await settle();

    // only the entry the account got as it is on the device leaves it
    await expect(guestLibrary().list()).resolves.toStrictEqual([changed]);
    // the account keeps the guest times, so the change is newer than the merged copy
    const merged = [mergedCopyOf(first, mergedAt), mergedCopyOf(other, mergedAt)];
    expect(merged.map(({ key }) => accountOf(0).stored(key))).toStrictEqual(merged);
    expect(merged[1]?.updatedAt).toBe(other.updatedAt);
    expect(changed.updatedAt > other.updatedAt).toBe(true);

    // the account keeps what the merge wrote: the next instance of the same user holds it
    supabaseLibraryModule.accountEntries.set(USER_A, merged);
    await reportSession(null);
    await reportSession(USER_A);
    await settle();

    // the change is sent again and, newer, replaces the merged copy (BR-08); then nothing is left
    // on the device that the account does not hold
    expect(accountOf(1).mergeGuestEntries.mock.calls).toStrictEqual([[[changed], MERGE_OPTIONS]]);
    expect(accountOf(1).stored(other.key)).toStrictEqual({
      ...changed,
      createdAt: merged[1]?.createdAt,
    });
    expect(accountOf(1).stored(first.key)).toStrictEqual(merged[0]);
    expect(storedGuestLibrary()).toBeUndefined();
  });
});
