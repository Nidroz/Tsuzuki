import { beforeEach, describe, expect, it } from '@jest/globals';
import { HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { EmailLinkCode } from '../auth-repository';
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

// supabase-js removes the link's verifier on every failed exchange: whatever the failure, the link
// is spent, so it rejects as link-invalid and a second try sends nothing

const AUTH_CODE = '6f1c2b0e-8a47-4d52-9a3e-2d1f0c9b7e41';
const PKCE_GRANT = { method: 'post', path: '/token', grantType: 'pkce' } as const;

interface FailedExchange {
  readonly label: string;
  readonly respond: () => Response;
}

// expected or transient causes: not reported (supabase-js reads any 5xx as a fetch failure)
const UNREPORTED_FAILURES: readonly FailedExchange[] = [
  { label: 'a lost connection', respond: () => HttpResponse.error() },
  {
    label: 'an unavailable service',
    respond: () => HttpResponse.json({ msg: SERVER_MESSAGE }, { status: 503 }),
  },
  {
    label: 'a server error',
    respond: () => authErrorResponse(500, 'unexpected_failure'),
  },
  { label: 'a rate limit', respond: () => authErrorResponse(429, 'over_request_rate_limit') },
  { label: 'a used code', respond: () => authErrorResponse(404, 'flow_state_not_found') },
];

// unknown causes: reported with the operation and the server code
const REPORTED_FAILURES: readonly (FailedExchange & { tags: Record<string, string> })[] = [
  {
    label: 'an unexpected server code',
    respond: () => authErrorResponse(400, 'validation_failed'),
    tags: { operation: 'complete-email-link', code: 'validation_failed' },
  },
  {
    label: 'an error without a code',
    respond: () => HttpResponse.json({ msg: SERVER_MESSAGE }, { status: 400 }),
    tags: { operation: 'complete-email-link' },
  },
  {
    label: 'a session without a user id',
    respond: () => HttpResponse.json({ ...createSession(), user: { id: EMAIL } }),
    tags: { operation: 'complete-email-link' },
  },
];

const FAILED_EXCHANGES: readonly FailedExchange[] = [...UNREPORTED_FAILURES, ...REPORTED_FAILURES];

describe('auth repository completeEmailLink failures', () => {
  let log: ReturnType<typeof createRequestLog>;
  let context: ReturnType<typeof createTestRepository>;

  // the email requested first, so this device holds the link's verifier; its exchange answers
  // `respond`
  const requestLink = async (respond: () => Response): Promise<EmailLinkCode> => {
    server.use(log.handler, endpointHandler(PKCE_GRANT, respond));
    await context.repository.signUp({ email: EMAIL, password: PASSWORD });
    const [signUp] = log.requests;
    return { code: AUTH_CODE, flowId: flowIdOf(signUp?.search.get('redirect_to') ?? null) };
  };

  const pkceRequests = () =>
    log.requests.filter(
      (request) => request.path === '/token' && request.search.get('grant_type') === 'pkce',
    );

  beforeEach(() => {
    log = createRequestLog();
    server.use(...successHandlers());
    context = createTestRepository();
  });

  it.each(FAILED_EXCHANGES)(
    'rejects $label as link-invalid, then a second try without a request',
    async ({ respond }) => {
      const link = await requestLink(respond);

      await expect(context.repository.completeEmailLink(link)).rejects.toMatchObject({
        name: 'AuthError',
        reason: 'link-invalid',
      });
      await expect(context.repository.completeEmailLink(link)).rejects.toMatchObject({
        name: 'AuthError',
        reason: 'link-invalid',
      });

      expect(pkceRequests()).toHaveLength(1);
    },
  );

  it.each(UNREPORTED_FAILURES)('does not report $label', async ({ respond }) => {
    const link = await requestLink(respond);

    await expect(context.repository.completeEmailLink(link)).rejects.toMatchObject({
      reason: 'link-invalid',
    });

    expect(context.captureError).not.toHaveBeenCalled();
  });

  it.each(REPORTED_FAILURES)(
    'reports $label as unknown, without personal data',
    async ({ respond, tags }) => {
      const link = await requestLink(respond);

      const error = await context.repository
        .completeEmailLink(link)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AuthError', reason: 'link-invalid' });
      expect(error).not.toHaveProperty('cause');
      expect(context.captureError).toHaveBeenCalledTimes(1);
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AuthError', reason: 'unknown' }),
        { source: 'auth', tags },
      );
      const reported = JSON.stringify(context.captureError.mock.calls);
      for (const personal of [EMAIL, PASSWORD, AUTH_CODE, SERVER_MESSAGE]) {
        expect(reported).not.toContain(personal);
      }
    },
  );
});
