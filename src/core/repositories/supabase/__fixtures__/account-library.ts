// the account library store under test: a real supabase-js client whose memory session storage
// holds a signed-in session (or none), over the library fake of library-handlers.ts, and a
// recording reporter. the test registers `backend.handler` with the msw server
import { jest } from '@jest/globals';

import type { ErrorReporter } from '../../../errors/error-reporter';
import { createSupabaseClient } from '../create-supabase-client';
import { createSupabaseLibraryRepository } from '../library-repository';
import { PROJECT_URL, USER_ID, createMemorySessionStorage, createSession } from './auth-handlers';
import { accessTokenOf, createLibraryBackend } from './library-handlers';

export const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

// where supabase-js keeps the session of PROJECT_URL: sb-<project ref>-auth-token
const SESSION_STORAGE_KEY = 'sb-project-ref-auth-token';
const ANON_KEY = 'anon-key';

/** a signed-in session of `userId`, with the access token the library fake reads the user from. */
export const sessionOf = (userId: string) => ({
  ...createSession(userId),
  access_token: accessTokenOf(userId),
});

export interface AccountLibraryOptions {
  /** the user the repository is created for. */
  readonly userId?: string;
  /** the user of the stored session, null for no session. */
  readonly sessionUserId?: string | null;
}

/** an account store of `userId` over a fresh fake, the stored session that of `sessionUserId`. */
export const createAccountLibrary = ({
  userId = USER_ID,
  sessionUserId = userId,
}: AccountLibraryOptions = {}) => {
  const backend = createLibraryBackend();
  const session = createMemorySessionStorage();
  if (sessionUserId !== null) {
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(sessionOf(sessionUserId)));
  }
  const client = createSupabaseClient({
    url: PROJECT_URL,
    anonKey: ANON_KEY,
    sessionStorage: session.storage,
  });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const repository = createSupabaseLibraryRepository(client, {
    userId,
    reporter: { captureError },
  });
  return { backend, session, client, repository, captureError };
};
