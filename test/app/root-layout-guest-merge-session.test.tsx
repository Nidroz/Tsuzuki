import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

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
  USER_B,
} from './guest-merge-session-support';

// the guest merge across session changes (A-04, ADR-0016): the guest entries go to the signed-in
// user's account library only, once per sign in, and a `+1` in its coalescing window at sign in
// reaches the guest store first. a merge in flight as its session ends or a guest entry changes
// is in root-layout-guest-merge-session-in-flight.test.tsx. every supabase factory is a fake

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
const { createAccountLibrary, guestLibrary, storedGuestLibrary, accountOf, reportSession, reset } =
  guestMergeSessionMocks();

beforeEach(() => {
  reset();
});

describe('root layout guest merge across sessions (A-04)', () => {
  it('merges the guest entries into the account library of the signed-in user only, once per sign in', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();

    await reportSession(USER_A);
    await settle();
    // a token refresh keeps the account library and merges nothing more
    await reportSession(USER_A);
    await reportSession(null);
    expect(await screen.findByTestId('library-empty')).toBeOnTheScreen();
    // used as a guest again, then another user signs in
    await guestLibrary().save(GUEST_OTHER);
    await reportSession(USER_B);
    await settle();

    expect(await screen.findByTestId(rowOf(GUEST_OTHER))).toBeOnTheScreen();
    expect(screen.queryByTestId(rowOf(GUEST_ENTRY))).not.toBeOnTheScreen();
    expect(createAccountLibrary.mock.calls.map(([, { userId }]) => userId)).toStrictEqual([
      USER_A,
      USER_B,
    ]);
    const [accountA, accountB] = [accountOf(0), accountOf(1)];
    expect(accountA.mergeGuestEntries.mock.calls).toStrictEqual([[[GUEST_ENTRY], MERGE_OPTIONS]]);
    expect(accountB.mergeGuestEntries.mock.calls).toStrictEqual([[[GUEST_OTHER], MERGE_OPTIONS]]);
    expect(accountA.stored(GUEST_OTHER.key)).toBeNull();
    expect(accountB.stored(GUEST_ENTRY.key)).toBeNull();
    expect(storedGuestLibrary()).toBeUndefined();
  });

  it('writes a `+1` still in its coalescing window to the guest store first, then merges it', async () => {
    await guestLibrary().save(GUEST_ENTRY);
    const user = userEvent.setup();
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Add one episode, Sousou no Frieren' }));

    // not written yet: the sign in lands inside the coalescing window
    await expect(guestLibrary().get(GUEST_ENTRY.key)).resolves.toMatchObject({
      progress: GUEST_ENTRY.progress,
    });

    await reportSession(USER_A);
    await settle();

    const merged = accountOf(0).mergeGuestEntries.mock.calls[0]?.[0];
    expect(merged?.map((entry) => entry.progress)).toStrictEqual([GUEST_ENTRY.progress + 1]);
    expect(accountOf(0).stored(GUEST_ENTRY.key)?.progress).toBe(GUEST_ENTRY.progress + 1);
    expect(storedGuestLibrary()).toBeUndefined();
    // the account library shows the merged progress: 12 + 1 of 28
    expect(await screen.findByTestId(rowOf(GUEST_ENTRY))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
  });
});
