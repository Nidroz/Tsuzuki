import { jest } from '@jest/globals';

import type * as SupabaseAuth from '@core/repositories/supabase/auth-repository';
import type { SupabaseAuthRepositoryOptions } from '@core/repositories/supabase/auth-repository';

import { createSessionAuthRepository, type FakeAuthRepository } from '../core/fake-auth-repository';

// the supabase modules the composition root wires (app/_layout.tsx), replaced so that no test
// creates a real supabase client: supabase-js would read the secure store and start its token
// refresh timer when the layout module loads. use them from jest.mock factories:
// jest.mock('@core/repositories/supabase/create-supabase-client', () => jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module').fakeSupabaseClientModule())
// jest.mock('@core/repositories/supabase/auth-repository', () => jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module').fakeSupabaseAuthModule())

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
 * repository reporting a signed-out session and accepting the auto refresh toggle; its other calls
 * reject until a test sets them up (`createSupabaseAuthRepository.mock.results[0]`)
 */
export const fakeSupabaseAuthModule = () => {
  const repository = createSessionAuthRepository();
  return {
    createSupabaseAuthRepository: jest.fn<
      (client: unknown, options: SupabaseAuthRepositoryOptions) => FakeAuthRepository
    >(() => repository),
  } satisfies typeof SupabaseAuth;
};

/** the mocked modules, as a test reads them with jest.requireMock */
export type FakeSupabaseClientModule = ReturnType<typeof fakeSupabaseClientModule>;
export type FakeSupabaseAuthModule = ReturnType<typeof fakeSupabaseAuthModule>;

/** the fake repository the mocked auth factory returned to the composition root */
export const appAuthRepositoryOf = (module: FakeSupabaseAuthModule): FakeAuthRepository => {
  const result = module.createSupabaseAuthRepository.mock.results[0];
  if (result?.type !== 'return') {
    throw new Error('the composition root created no auth repository');
  }
  return result.value;
};
