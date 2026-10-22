import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { AuthErrorReason } from '../../errors/auth-errors';
import type { AuthRepository } from '../auth-repository';
import {
  EMAIL,
  PASSWORD,
  SERVER_MESSAGE,
  authErrorResponse,
  createRequestLog,
  createSession,
  createTestRepository,
  endpointHandler,
  flowIdOf,
  successHandlers,
} from './__fixtures__/auth-handlers';

const AUTH_CODE = '6f1c2b0e-8a47-4d52-9a3e-2d1f0c9b7e41';
const NEW_PASSWORD = 'new-password-1';
// past the one hour expiry of the test sessions
const SESSION_EXPIRED_AFTER_MS = 2 * 60 * 60 * 1000;
// longer than every refresh retry of supabase-js (its 30 s auto refresh tick)
const REFRESH_RETRIES_MS = 60 * 1000;

type Endpoint = Parameters<typeof endpointHandler>[0];

const SIGN_UP: Endpoint = { method: 'post', path: '/signup' };
const RESEND: Endpoint = { method: 'post', path: '/resend' };
const RECOVER: Endpoint = { method: 'post', path: '/recover' };
const PASSWORD_GRANT: Endpoint = { method: 'post', path: '/token', grantType: 'password' };
const PKCE_GRANT: Endpoint = { method: 'post', path: '/token', grantType: 'pkce' };
const USER: Endpoint = { method: 'put', path: '/user' };

type Call = (repository: AuthRepository) => Promise<unknown>;

const signUp: Call = (repository) => repository.signUp({ email: EMAIL, password: PASSWORD });
const resend: Call = (repository) => repository.resendConfirmation(EMAIL);
const requestReset: Call = (repository) => repository.requestPasswordReset(EMAIL);
const signIn: Call = (repository) => repository.signIn({ email: EMAIL, password: PASSWORD });

// signed in first, as after the recovery link exchange
const updatePassword: Call = async (repository) => {
  await signIn(repository);
  return repository.updatePassword(NEW_PASSWORD);
};

// the email requested first, so this device holds the link's verifier
const completeLink: Call = async (repository) => {
  const log = createRequestLog();
  server.use(log.handler);
  await signUp(repository);
  const flowId = flowIdOf(log.requests[0]?.search.get('redirect_to') ?? null);
  return repository.completeEmailLink({ code: AUTH_CODE, flowId });
};

interface ErrorCase {
  readonly label: string;
  readonly call: Call;
  readonly endpoint: Endpoint;
  readonly respond: () => Response;
  readonly reason: AuthErrorReason;
}

const EXPECTED_ERRORS: readonly ErrorCase[] = [
  {
    label: 'wrong credentials',
    call: signIn,
    endpoint: PASSWORD_GRANT,
    respond: () => authErrorResponse(400, 'invalid_credentials'),
    reason: 'invalid-credentials',
  },
  {
    label: 'an unconfirmed email',
    call: signIn,
    endpoint: PASSWORD_GRANT,
    respond: () => authErrorResponse(400, 'email_not_confirmed'),
    reason: 'email-not-confirmed',
  },
  {
    label: 'a weak password at sign up',
    call: signUp,
    endpoint: SIGN_UP,
    respond: () => authErrorResponse(422, 'weak_password'),
    reason: 'weak-password',
  },
  {
    label: 'a weak new password',
    call: updatePassword,
    endpoint: USER,
    respond: () => authErrorResponse(422, 'weak_password'),
    reason: 'weak-password',
  },
  {
    label: 'the current password as the new one',
    call: updatePassword,
    endpoint: USER,
    respond: () => authErrorResponse(422, 'same_password'),
    reason: 'same-password',
  },
  {
    label: 'the email send rate limit',
    call: resend,
    endpoint: RESEND,
    respond: () => authErrorResponse(429, 'over_email_send_rate_limit'),
    reason: 'rate-limited',
  },
  {
    label: 'the request rate limit',
    call: signIn,
    endpoint: PASSWORD_GRANT,
    respond: () => authErrorResponse(429, 'over_request_rate_limit'),
    reason: 'rate-limited',
  },
  {
    label: 'a 429 with another code',
    call: requestReset,
    endpoint: RECOVER,
    respond: () => authErrorResponse(429, 'over_sms_send_rate_limit'),
    reason: 'rate-limited',
  },
  {
    label: 'a failed captcha',
    call: signUp,
    endpoint: SIGN_UP,
    respond: () => authErrorResponse(400, 'captcha_failed'),
    reason: 'captcha-failed',
  },
  {
    label: 'a used code',
    call: completeLink,
    endpoint: PKCE_GRANT,
    respond: () => authErrorResponse(404, 'flow_state_not_found'),
    reason: 'link-invalid',
  },
  {
    label: 'an expired code',
    call: completeLink,
    endpoint: PKCE_GRANT,
    respond: () => authErrorResponse(400, 'flow_state_expired'),
    reason: 'link-invalid',
  },
  {
    label: 'a code of another verifier',
    call: completeLink,
    endpoint: PKCE_GRANT,
    respond: () => authErrorResponse(400, 'bad_code_verifier'),
    reason: 'link-invalid',
  },
  {
    label: 'no connection',
    call: signIn,
    endpoint: PASSWORD_GRANT,
    respond: () => HttpResponse.error(),
    reason: 'network',
  },
  {
    label: 'an unavailable service',
    call: requestReset,
    endpoint: RECOVER,
    respond: () => HttpResponse.json({ msg: SERVER_MESSAGE }, { status: 503 }),
    reason: 'network',
  },
];

const UNKNOWN_ERRORS: readonly (Omit<ErrorCase, 'reason'> & { tags: Record<string, string> })[] = [
  {
    label: 'an address the project refuses',
    call: signUp,
    endpoint: SIGN_UP,
    respond: () => authErrorResponse(403, 'email_address_not_authorized'),
    tags: { operation: 'sign-up', code: 'email_address_not_authorized' },
  },
  {
    label: 'a code that is not an identifier',
    call: resend,
    endpoint: RESEND,
    respond: () => authErrorResponse(400, `Bad code for ${EMAIL}`),
    tags: { operation: 'resend-confirmation' },
  },
  {
    label: 'an error without a code',
    call: completeLink,
    endpoint: PKCE_GRANT,
    respond: () => HttpResponse.json({ msg: SERVER_MESSAGE }, { status: 400 }),
    tags: { operation: 'complete-email-link' },
  },
  {
    label: 'a session without a user id',
    call: signIn,
    endpoint: PASSWORD_GRANT,
    respond: () => HttpResponse.json({ ...createSession(), user: { id: EMAIL } }),
    tags: { operation: 'sign-in' },
  },
];

describe('auth repository errors', () => {
  let context: ReturnType<typeof createTestRepository>;

  beforeEach(() => {
    server.use(...successHandlers());
    context = createTestRepository();
  });

  it.each(EXPECTED_ERRORS)(
    'rejects $label with $reason, unreported',
    async ({ call, endpoint, respond, reason }) => {
      server.use(endpointHandler(endpoint, respond));

      const error = await call(context.repository).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AuthError', reason });
      expect(context.captureError).not.toHaveBeenCalled();
    },
  );

  it.each(UNKNOWN_ERRORS)(
    'rejects $label as unknown and reports it without personal data',
    async ({ call, endpoint, respond, tags }) => {
      server.use(endpointHandler(endpoint, respond));

      const error = await call(context.repository).catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AuthError', reason: 'unknown' });
      expect(error).toHaveProperty('message', 'Auth request failed');
      expect(error).not.toHaveProperty('cause');
      expect(context.captureError).toHaveBeenCalledWith(error, { source: 'auth', tags });
      const reported = JSON.stringify(context.captureError.mock.calls);
      for (const personal of [EMAIL, PASSWORD, AUTH_CODE, SERVER_MESSAGE]) {
        expect(reported).not.toContain(personal);
      }
    },
  );

  it('resolves a sign out the server failed once the session is gone, reporting the failure', async () => {
    await signIn(context.repository);
    server.use(
      endpointHandler({ method: 'post', path: '/logout' }, () =>
        authErrorResponse(400, 'unexpected_failure'),
      ),
    );

    await expect(context.repository.signOut()).resolves.toBeUndefined();

    expect(context.session.values.size).toBe(0);
    expect(context.captureError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unknown' }),
      {
        source: 'auth',
        tags: { operation: 'sign-out', code: 'unexpected_failure' },
      },
    );
  });

  it('rejects an offline sign out of an expired session as network, keeping the session', async () => {
    await signIn(context.repository);
    jest.setSystemTime(Date.now() + SESSION_EXPIRED_AFTER_MS);
    server.use(
      endpointHandler({ method: 'post', path: '/token', grantType: 'refresh_token' }, () =>
        HttpResponse.error(),
      ),
    );

    const pending = context.repository.signOut().catch((caught: unknown) => caught);
    // supabase-js retries the refresh with a backoff before giving up
    await jest.advanceTimersByTimeAsync(REFRESH_RETRIES_MS);

    expect(await pending).toMatchObject({ name: 'AuthError', reason: 'network' });
    expect(context.session.values.size).toBeGreaterThan(0);
    expect(context.captureError).not.toHaveBeenCalled();
  });

  it('rejects a sign out the device could not complete as unknown', async () => {
    await signIn(context.repository);
    // an unreadable session store: supabase-js cannot remove the session
    const failingRead = new Error(`storage failed for ${EMAIL}`);
    context.session.storage.getItem = () => Promise.reject(failingRead);

    const error = await context.repository.signOut().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AuthError', reason: 'unknown' });
    expect(context.captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'sign-out' },
    });
  });
});
