// the account library store under test: a real supabase-js client whose memory session storage
// holds a signed-in session (or none), over the library fake of library-handlers.ts, and a
// recording reporter. the test registers `backend.handler` with the msw server
import { jest } from '@jest/globals';

import type { LibraryEntry } from '../../../domain/library-entry';
import type { ErrorReporter } from '../../../errors/error-reporter';
import type { SessionStorage } from '../../session-storage';
import { createSupabaseClient } from '../create-supabase-client';
import { createSupabaseLibraryRepository } from '../library-repository';
import { PROJECT_URL, USER_ID, createMemorySessionStorage, createSession } from './auth-handlers';
import { accessTokenOf, createLibraryBackend, type LibraryBackend } from './library-handlers';
import { rowOfEntry } from './postgrest-fake';

export const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

// where supabase-js keeps the session of PROJECT_URL: sb-<project ref>-auth-token
export const SESSION_STORAGE_KEY = 'sb-project-ref-auth-token';
const ANON_KEY = 'anon-key';
// the ids of seeded rows, apart from those the fake gives the rows it inserts
const SEEDED_ROW_INDEX = 900;

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
  /** a session storage whose reads never settle (a stalled secure store). */
  readonly stalledSessionRead?: boolean;
}

/** an account store of `userId` over a fresh fake, the stored session that of `sessionUserId`. */
export const createAccountLibrary = ({
  userId = USER_ID,
  sessionUserId = userId,
  stalledSessionRead = false,
}: AccountLibraryOptions = {}) => {
  const backend = createLibraryBackend();
  const session = createMemorySessionStorage();
  if (sessionUserId !== null) {
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(sessionOf(sessionUserId)));
  }
  const sessionStorage: SessionStorage = stalledSessionRead
    ? { ...session.storage, getItem: () => new Promise<string | null>(() => undefined) }
    : session.storage;
  const client = createSupabaseClient({ url: PROJECT_URL, anonKey: ANON_KEY, sessionStorage });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const repository = createSupabaseLibraryRepository(client, {
    userId,
    reporter: { captureError },
  });
  return { backend, session, client, repository, captureError };
};

/** stores `entries` as rows of `userId`, each with its own timestamps. */
export const seedEntries = (
  backend: LibraryBackend,
  entries: readonly LibraryEntry[],
  userId: string = USER_ID,
): void => {
  backend.seed(
    ...entries.map((entry, index) => rowOfEntry(userId, SEEDED_ROW_INDEX + index, entry)),
  );
};
