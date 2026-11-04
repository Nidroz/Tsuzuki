import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { AuthError } from '../../errors/auth-errors';
import { OTHER_USER_ID, SESSION_STORAGE_KEY, sessionOf } from './__fixtures__/account-library';
import { AUTH_URL, EMAIL, USER_ID } from './__fixtures__/auth-handlers';
import { accessTokenOf } from './__fixtures__/library-handlers';
import { gotrueError, setupUserGone as setupDetector } from './__fixtures__/user-gone';

// what reports a user gone (ADR-0018, update of 2026-11-04): only the auth server answering
// user_not_found for the session's own unexpired access token, checked after a refused refresh.
// every other outcome reports nothing and changes nothing. delivery: auth-repository-user-gone-
// delivery.test.ts

const EXPIRES_IN_MS = 3_600_000;
const bearerOf = (userId: string) => `Bearer ${accessTokenOf(userId)}`;

// the setup, its GET /auth/v1/user handler registered
const setupUserGone = (...args: Parameters<typeof setupDetector>) => {
  const setup = setupDetector(...args);
  server.use(setup.userHandler);
  return setup;
};

describe('onUserGone outcomes', () => {
  it("reports the session's user once the auth server answers user_not_found for its token", async () => {
    const { repository, answerUser, refuseAndCheck, userChecks, captureError, session } =
      setupUserGone();
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(listener.mock.calls).toStrictEqual([[USER_ID]]);
    expect(userChecks).toStrictEqual([bearerOf(USER_ID)]);
    expect(captureError).not.toHaveBeenCalled();
    // it purges nothing and signs nothing out: the hooks decide
    expect(session.values.has(SESSION_STORAGE_KEY)).toBe(true);
  });

  it('reports the user of the session whose token was checked, never another id', async () => {
    const { repository, answerUser, refuseAndCheck, userChecks, storeSession } = setupUserGone();
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);
    storeSession(OTHER_USER_ID);
    // the server's answer names no user: the id comes from the session only
    answerUser(() => gotrueError(403, 'user_not_found'));

    await refuseAndCheck();

    expect(listener.mock.calls).toStrictEqual([[OTHER_USER_ID]]);
    expect(userChecks).toStrictEqual([bearerOf(OTHER_USER_ID)]);
  });

  it('reports a user gone through the whole chain: a refresh refused by the auth server', async () => {
    const { client, repository, answerUser, getSession, getUser } = setupUserGone();
    server.use(http.post(`${AUTH_URL}/token`, () => gotrueError(400, 'refresh_token_not_found')));
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    const { error } = await client.auth.refreshSession();
    await jest.advanceTimersByTimeAsync(0);
    await Promise.allSettled(getSession.mock.results.map(({ value }) => value));
    await Promise.allSettled(getUser.mock.results.map(({ value }) => value));
    await jest.advanceTimersByTimeAsync(0);

    expect(error).toMatchObject({ code: 'refresh_token_not_found' });
    expect(listener.mock.calls).toStrictEqual([[USER_ID]]);
  });

  it.each([
    ['a revoked session (session_not_found)', () => gotrueError(403, 'session_not_found')],
    ['an expired or invalid token (bad_jwt)', () => gotrueError(403, 'bad_jwt')],
    ['another code', () => gotrueError(403, 'not_admin')],
    ['a 404 without a code', () => HttpResponse.json({}, { status: 404 })],
    ['a server error', () => gotrueError(500, 'unexpected_failure')],
    ['a gateway error', () => new HttpResponse('bad gateway', { status: 502 })],
    ['a lost connection', () => HttpResponse.error()],
    ['the user (a success)', undefined],
  ])('reports nothing and nothing to the reporter for %s', async (_case, responder) => {
    const { repository, answerUser, refuseAndCheck, userChecks, captureError } = setupUserGone();
    if (responder !== undefined) {
      answerUser(responder);
    }
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(userChecks).toStrictEqual([bearerOf(USER_ID)]);
    expect(listener).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('leaves a revoked session to auth-js, which removes it itself, without a report', async () => {
    const { repository, answerUser, refuseAndCheck, session } = setupUserGone();
    answerUser(() => gotrueError(403, 'session_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(listener).not.toHaveBeenCalled();
    expect(session.values.has(SESSION_STORAGE_KEY)).toBe(false);
  });

  it('sends nothing and reports nothing without a session', async () => {
    const { repository, refuseAndCheck, userChecks, captureError } = setupUserGone({
      sessionUserId: null,
    });
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(userChecks).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    ['no expiry', { expires_at: null }],
    ['a user id that is not a uuid', { user: { id: 'not-a-uuid' } }],
  ])('sends nothing for a stored session with %s', async (_case, change) => {
    const { repository, answerUser, refuseAndCheck, userChecks, session } = setupUserGone();
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify({ ...sessionOf(USER_ID), ...change }));
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(userChecks).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('sends nothing for an access token expired by the injected clock', async () => {
    const { repository, answerUser, refuseAndCheck, userChecks } = setupUserGone({
      now: () => Date.now() + EXPIRES_IN_MS,
    });
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(userChecks).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('checks an access token one second before its expiry', async () => {
    const { repository, answerUser, refuseAndCheck, userChecks } = setupUserGone({
      now: () => Date.now() + EXPIRES_IN_MS - 1000,
    });
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(userChecks).toHaveLength(1);
    expect(listener.mock.calls).toStrictEqual([[USER_ID]]);
  });

  it('never checks without the refused refreshes in its options', async () => {
    const { repository, answerUser, refuseAndCheck, userChecks, getSession } = setupUserGone({
      withRefusals: false,
    });
    answerUser(() => gotrueError(403, 'user_not_found'));
    const listener = jest.fn<(userId: string) => void>();
    repository.onUserGone(listener);

    await refuseAndCheck();

    expect(getSession).not.toHaveBeenCalled();
    expect(userChecks).toStrictEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['getSession', 'getUser'] as const)(
    'reports a %s that throws as a fixed unknown error under its operation only',
    async (method) => {
      const { repository, answerUser, refuseAndCheck, captureError, getSession, getUser } =
        setupUserGone();
      answerUser(() => gotrueError(403, 'user_not_found'));
      const spy = method === 'getSession' ? getSession : getUser;
      spy.mockRejectedValueOnce(new Error(`failed for ${EMAIL}, user ${USER_ID}`));
      const listener = jest.fn<(userId: string) => void>();
      repository.onUserGone(listener);

      await refuseAndCheck();

      expect(listener).not.toHaveBeenCalled();
      expect(captureError.mock.calls).toStrictEqual([
        [new AuthError('unknown'), { source: 'auth', tags: { operation: 'user-gone' } }],
      ]);
      const error = captureError.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AuthError);
      expect(error instanceof Error && error.cause).toBeUndefined();
    },
  );
});
