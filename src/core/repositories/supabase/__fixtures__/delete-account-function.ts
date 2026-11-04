// the delete-account edge function as an msw handler, and the account deletion over a real
// supabase-js client whose session storage holds a session, none, or never answers, for the
// account-deletion.ts tests. the test registers `handler` with the msw server
import { expect, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import type { ErrorReporter } from '../../../errors/error-reporter';
import type { SessionStorage } from '../../session-storage';
import { ACCOUNT_DELETION_FUNCTION, requestAccountDeletion } from '../account-deletion';
import { createSupabaseClient } from '../create-supabase-client';
import { SESSION_STORAGE_KEY } from './account-library';
import { PROJECT_URL, createMemorySessionStorage, createSession } from './auth-handlers';

export const FUNCTION_URL = `${PROJECT_URL}/functions/v1/${ACCOUNT_DELETION_FUNCTION}`;
export const DELETED = { deleted: true };
const ANON_KEY = 'anon-key';

export interface FunctionRequest {
  readonly method: string;
  readonly search: string;
  readonly body: string;
  readonly authorization: string | null;
}

/** what the session storage holds: a signed-in session, none, or a read that never answers. */
export type SessionRead = 'stored' | 'none' | 'stalled';

/**
 * a client over a session storage as `read` says, a recording reporter, the function's `handler`
 * and the requests it received, `answer` (how the function answers from now on; DELETED until
 * then), and `failureOf` (the rejection of a deletion, null when it resolved).
 */
export const setupDeletion = (read: SessionRead = 'stored') => {
  const session = createMemorySessionStorage();
  if (read === 'stored') {
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(createSession()));
  }
  const sessionStorage: SessionStorage = {
    ...session.storage,
    ...(read === 'stalled' && { getItem: () => new Promise<string | null>(() => undefined) }),
  };
  const client = createSupabaseClient({ url: PROJECT_URL, anonKey: ANON_KEY, sessionStorage });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const requests: FunctionRequest[] = [];
  let respond = (): Response | Promise<Response> => HttpResponse.json(DELETED);
  const handler = http.all(FUNCTION_URL, async ({ request }) => {
    requests.push({
      method: request.method,
      search: new URL(request.url).search,
      body: await request.text(),
      authorization: request.headers.get('authorization'),
    });
    return respond();
  });
  const answer = (responder: () => Response | Promise<Response>): void => {
    respond = responder;
  };
  const deleteAccount = (): Promise<void> => requestAccountDeletion(client, { captureError });
  const failureOf = (): Promise<unknown> =>
    deleteAccount().then(
      () => null,
      (error: unknown) => error,
    );
  return { client, captureError, handler, requests, answer, deleteAccount, failureOf };
};

/** an AccountDeletionError of `reason`, as an asymmetric matcher. */
export const deletionError = (reason: string) =>
  expect.objectContaining({ name: 'AccountDeletionError', reason });
