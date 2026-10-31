import { jest } from '@jest/globals';

import type { LibraryEntry } from '@core/domain/library-entry';
import type * as SupabaseAuth from '@core/repositories/supabase/auth-repository';
import type { SupabaseAuthRepositoryOptions } from '@core/repositories/supabase/auth-repository';
import type * as SupabaseLibrary from '@core/repositories/supabase/library-repository';
import type { SupabaseLibraryRepositoryOptions } from '@core/repositories/supabase/library-repository';

import {
  createSessionAuthRepository,
  createSessionSource,
  type FakeAuthRepository,
} from '../core/fake-auth-repository';
import {
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../core/fake-library-repository';

// the supabase modules the composition root wires (app/_layout.tsx), replaced so that no test
// creates a real supabase client: supabase-js would read the secure store and start its token
// refresh timer when the layout module loads. use them from jest.mock factories:
// jest.mock('@core/repositories/supabase/create-supabase-client', () => jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module').fakeSupabaseClientModule())
// jest.mock('@core/repositories/supabase/auth-repository', () => jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module').fakeSupabaseAuthModule())
// jest.mock('@core/repositories/supabase/library-repository', () => jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module').fakeSupabaseLibraryModule())

/** a stand-in for the supabase client: only the mocked auth factory below receives it */
export const FAKE_SUPABASE_CLIENT = Object.freeze({ fakeSupabaseClient: true });

/** the client module, whose factory records its config and returns FAKE_SUPABASE_CLIENT */
export const fakeSupabaseClientModule = () => ({
  createSupabaseClient: jest.fn<(config: unknown) => typeof FAKE_SUPABASE_CLIENT>(
    () => FAKE_SUPABASE_CLIENT,
  ),
});

/**
 * the auth repository module, whose factory records its arguments and always returns one fake
 * repository reporting the session of `sessionSource` (signed out until a test emits another) and
 * accepting the auto refresh toggle; its other calls reject until a test sets them up
 * (`createSupabaseAuthRepository.mock.results[0]`)
 */
export const fakeSupabaseAuthModule = () => {
  const sessionSource = createSessionSource(null);
  const repository = createSessionAuthRepository(null, {
    onAuthStateChange: sessionSource.subscribe,
  });
  const module = {
    createSupabaseAuthRepository: jest.fn<
      (client: unknown, options: SupabaseAuthRepositoryOptions) => FakeAuthRepository
    >(() => repository),
  } satisfies typeof SupabaseAuth;
  return { ...module, sessionSource };
};

/**
 * the account library module, whose factory records its arguments and returns a new fake
 * repository per call, holding the entries a test put in `accountEntries` for its user id (empty
 * otherwise); the composition root reads its factory only
 */
export const fakeSupabaseLibraryModule = () => {
  const accountEntries = new Map<string, readonly LibraryEntry[]>();
  const module = {
    createSupabaseLibraryRepository: jest.fn<
      (client: unknown, options: SupabaseLibraryRepositoryOptions) => FakeLibraryRepository
    >((_client, { userId }) => createFakeLibraryRepository(accountEntries.get(userId) ?? [])),
  } satisfies Pick<typeof SupabaseLibrary, 'createSupabaseLibraryRepository'>;
  return { ...module, accountEntries };
};

/** the mocked modules, as a test reads them with jest.requireMock */
export type FakeSupabaseClientModule = ReturnType<typeof fakeSupabaseClientModule>;
export type FakeSupabaseAuthModule = ReturnType<typeof fakeSupabaseAuthModule>;
export type FakeSupabaseLibraryModule = ReturnType<typeof fakeSupabaseLibraryModule>;

/** the fake repository the mocked auth factory returned to the composition root */
export const appAuthRepositoryOf = (module: FakeSupabaseAuthModule): FakeAuthRepository => {
  const result = module.createSupabaseAuthRepository.mock.results[0];
  if (result?.type !== 'return') {
    throw new Error('the composition root created no auth repository');
  }
  return result.value;
};
