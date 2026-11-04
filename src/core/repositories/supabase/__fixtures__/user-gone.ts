// the user gone check of the auth repository (user-gone-detector.ts) over a real supabase-js
// client, told of refused refreshes by a real TokenRefreshRefusalSignal: the msw stand-in of
// GET /auth/v1/user answers what the auth server answered on the local stack, so the error
// mapping of auth-js runs for real. the test registers `userHandler` with the msw server
import { jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import type { ErrorReporter } from '../../../errors/error-reporter';
import { createSupabaseAuthRepository } from '../auth-repository';
import { createSupabaseClient } from '../create-supabase-client';
import { createTokenRefreshRefusalSignal } from '../token-refresh-refusals';
import { SESSION_STORAGE_KEY, sessionOf } from './account-library';
import {
  AUTH_URL,
  CONFIRMATION_URL,
  PASSWORD_RESET_URL,
  PROJECT_URL,
  SERVER_MESSAGE,
  USER_ID,
  createMemorySessionStorage,
  createUser,
} from './auth-handlers';

const ANON_KEY = 'anon-key';

/**
 * a gotrue error as the auth server answers it: the http status, the numeric `code` and the
 * `error_code` auth-js reads, and a server message.
 */
export const gotrueError = (status: number, errorCode: string): Response =>
  HttpResponse.json({ code: status, error_code: errorCode, msg: SERVER_MESSAGE }, { status });

export interface UserGoneSetup {
  /** the user of the stored session, null for no session. */
  readonly sessionUserId?: string | null;
  /** the repository's wall clock; the repository default when left out. */
  readonly now?: () => number;
  /** false: the repository is created without refreshRefusals. */
  readonly withRefusals?: boolean;
}

/**
 * a repository whose session storage holds the session of `sessionUserId`, the signal of its
 * client's refused refreshes, the handler of GET /auth/v1/user (`userHandler`) and the
 * authorization header of each request it received, `answerUser` (how it answers from now on: the
 * session's user until then), the reporter's mock, and `refuseAndCheck`: one refusal told,
 * awaited until its check ended.
 */
export const setupUserGone = ({
  sessionUserId = USER_ID,
  now,
  withRefusals = true,
}: UserGoneSetup = {}) => {
  const session = createMemorySessionStorage();
  const storeSession = (userId: string): void => {
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(sessionOf(userId)));
  };
  if (sessionUserId !== null) {
    storeSession(sessionUserId);
  }
  const refusals = createTokenRefreshRefusalSignal();
  const client = createSupabaseClient({
    url: PROJECT_URL,
    anonKey: ANON_KEY,
    sessionStorage: session.storage,
    onTokenRefreshRefused: refusals.notify,
  });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const repository = createSupabaseAuthRepository(client, {
    confirmationRedirectUrl: CONFIRMATION_URL,
    passwordResetRedirectUrl: PASSWORD_RESET_URL,
    reporter: { captureError },
    ...(withRefusals && { refreshRefusals: refusals }),
    ...(now !== undefined && { now }),
  });

  const userChecks: string[] = [];
  let respond = (): Response | Promise<Response> =>
    HttpResponse.json(createUser(sessionUserId ?? USER_ID));
  const userHandler = http.get(`${AUTH_URL}/user`, ({ request }) => {
    userChecks.push(request.headers.get('authorization') ?? '');
    return respond();
  });
  const answerUser = (responder: () => Response | Promise<Response>): void => {
    respond = responder;
  };

  const getSession = jest.spyOn(client.auth, 'getSession');
  const getUser = jest.spyOn(client.auth, 'getUser');
  // every promise a spy returned from `from` on, settled
  const settledFrom = async (spy: { mock: { results: { value: unknown }[] } }, from: number) => {
    await Promise.allSettled(spy.mock.results.slice(from).map(({ value }) => value));
  };
  const refuseAndCheck = async (): Promise<void> => {
    const sessionReads = getSession.mock.results.length;
    const userReads = getUser.mock.results.length;
    refusals.notify();
    await settledFrom(getSession, sessionReads);
    await settledFrom(getUser, userReads);
    // the check's own continuation, then the end of its run
    await jest.advanceTimersByTimeAsync(0);
  };

  return {
    session,
    storeSession,
    refusals,
    client,
    repository,
    captureError,
    userHandler,
    userChecks,
    answerUser,
    getSession,
    getUser,
    refuseAndCheck,
  };
};
