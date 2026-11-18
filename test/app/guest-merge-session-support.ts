// shared steps of the route tests of the guest merge across session changes (A-04, BR-08,
// ADR-0016): two placeholder users, two guest entries, the shared app storage, and the mocked
// supabase and local library modules read from the mock registry (each test file declares the
// mocks)
import type { LibraryEntry } from '@core/domain/library-entry';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { expect, jest } from '@jest/globals';
import { APP_STORAGE_INSTANCE_ID } from '@platform/app-storage-instance';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import { createMMKV } from 'react-native-mmkv';

import { entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';

/** the options of every guest merge call: the signal of its run, aborted once its session ended */
export const MERGE_OPTIONS = { signal: expect.any(AbortSignal) };

// placeholder user ids
export const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// no cover: the rows need no image host
const noCover = { ...entryOf().media, imageUrl: null };
/** two guest entries, of two media */
export const GUEST_ENTRY = entryOf({ media: noCover });
export const GUEST_OTHER = entryWithMedia(
  { imageUrl: null, title: 'Guest title' },
  { key: keyOf('manga', 2), updatedAt: '2026-02-01T00:00:00.000Z' },
);

export const rowOf = (entry: LibraryEntry): string =>
  `library-entry-${entry.key.namespace}-${entry.key.kind}-${String(entry.key.externalId)}`;

/** the app storage the layout opened: the encrypted instance, shared in memory by id */
const appStorage = createMMKV({ id: APP_STORAGE_INSTANCE_ID });

/** the merge steps settle inside act, after `ms` of fake time: no merge update lands outside it */
export const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

/**
 * the mocks of a test file that declares jest.mock for the supabase client, auth and library
 * modules (test/mobile/fake-supabase-module.ts) and wraps the local library factory in a jest.fn.
 * call it at module level, after the jest.mock calls
 */
export const guestMergeSessionMocks = () => {
  const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
    '@core/repositories/supabase/auth-repository',
  );
  const supabaseLibraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
    '@core/repositories/supabase/library-repository',
  );
  const localLibrary = jest.requireMock<typeof LocalLibrary>(
    '@core/repositories/local/library-repository',
  );
  const createAccountLibrary = supabaseLibraryModule.createSupabaseLibraryRepository;

  return {
    supabaseLibraryModule,
    createAccountLibrary,
    /** the guest repository the layout created when it loaded */
    guestLibrary: (): GuestLibraryRepository => {
      const created = jest.mocked(localLibrary.createLocalLibraryRepository).mock.results[0];
      if (created?.type !== 'return') {
        throw new Error('the composition root created no guest library repository');
      }
      return created.value;
    },
    storedGuestLibrary: (): string | undefined =>
      appStorage.getString(localLibrary.GUEST_LIBRARY_STORAGE_KEY),
    /** the account repository of the nth factory call (0 first) since the test started */
    accountOf: (call: number) => {
      const result = createAccountLibrary.mock.results[call];
      if (result?.type !== 'return') {
        throw new Error('the composition root created no account library repository');
      }
      return result.value;
    },
    reportSession: async (userId: string | null) => {
      await act(async () => {
        supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
        await jest.advanceTimersByTimeAsync(0);
      });
    },
    /** for beforeEach: empty storage and accounts, no account setup, signed out */
    reset: () => {
      appStorage.clearAll();
      supabaseLibraryModule.accountEntries.clear();
      supabaseLibraryModule.accountSetups.length = 0;
      createAccountLibrary.mockClear();
      // no listener between tests: this sets the session the next mount reports, signed out
      supabaseAuthModule.sessionSource.emit(null);
    },
  };
};
