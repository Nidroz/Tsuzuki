import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthError as SupabaseAuthError } from '@supabase/supabase-js';
import { HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type {
  AuthSession,
  OAuthBrowser,
  OAuthBrowserResult,
  OAuthProvider,
} from '../auth-repository';
import {
  ACCESS_TOKEN,
  AUTH_URL,
  OAUTH_REDIRECT_URL,
  SERVER_MESSAGE,
  USER_ID,
  authErrorResponse,
  createRequestLog,
  createSession,
  createTestRepository,
  endpointHandler,
  flowIdOf,
  s256,
  successHandlers,
} from './__fixtures__/auth-handlers';

const AUTH_CODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_FLOW_ID = 'aaaaaaaa-flow-id';
const PKCE_GRANT = { method: 'post', path: '/token', grantType: 'pkce' } as const;
const SIGNED_IN: AuthSession = { userId: USER_ID };
const OAUTH_REPORT = { source: 'auth', tags: { operation: 'oauth-sign-in' } };

// how the fake browser session ends, given the flow id of the authorize url it was opened with
type BrowserAnswer = (flowId: string) => OAuthBrowserResult;

const redirectWith = (params: string): OAuthBrowserResult => ({
  type: 'redirect',
  url: `${OAUTH_REDIRECT_URL}?${params}`,
});

const codeRedirect: BrowserAnswer = (flowId) =>
  redirectWith(`sb_flow_id=${flowId}&code=${AUTH_CODE}`);

// the authorize url is read with node's URL: the test runs in node, not on the device
const authorizeParams = (url: string | undefined): URLSearchParams =>
  new URL(url ?? '').searchParams;

describe('auth repository signInWithProvider', () => {
  let log: ReturnType<typeof createRequestLog>;

  const setUp = (answer: BrowserAnswer, providers: readonly OAuthProvider[] = ['google']) => {
    const openAuthSession = jest.fn<OAuthBrowser['openAuthSession']>((url) =>
      Promise.resolve(answer(flowIdOf(authorizeParams(url).get('redirect_to')))),
    );
    const context = createTestRepository({
      oauth: { browser: { openAuthSession }, providers, redirectUrl: OAUTH_REDIRECT_URL },
    });
    return { ...context, openAuthSession };
  };

  const tokenRequests = () => log.requests.filter((request) => request.path === '/token');

  // everything reported, which must hold no code, flow id, url or server text
  const expectNothingPersonalReported = (reports: unknown, flowIds: readonly string[]) => {
    const reported = JSON.stringify(reports);
    for (const personal of [AUTH_CODE, OAUTH_REDIRECT_URL, AUTH_URL, SERVER_MESSAGE, ...flowIds]) {
      expect(reported).not.toContain(personal);
    }
  };

  beforeEach(() => {
    log = createRequestLog();
    server.use(log.handler, ...successHandlers());
  });

  it.each<OAuthProvider>(['google', 'apple'])(
    'signs in with %s through a pkce browser session',
    async (provider) => {
      const context = setUp(codeRedirect, ['google', 'apple']);

      await expect(context.repository.signInWithProvider(provider)).resolves.toStrictEqual(
        SIGNED_IN,
      );

      const [[url, redirectUrl] = []] = context.openAuthSession.mock.calls;
      expect(redirectUrl).toBe(OAUTH_REDIRECT_URL);
      expect(url?.startsWith(`${AUTH_URL}/authorize?`)).toBe(true);
      const params = authorizeParams(url);
      expect(params.get('provider')).toBe(provider);
      const flowId = flowIdOf(params.get('redirect_to'));
      expect(params.get('redirect_to')).toBe(`${OAUTH_REDIRECT_URL}?sb_flow_id=${flowId}`);
      expect(params.get('code_challenge_method')).toBe('s256');
      const [exchange] = tokenRequests();
      expect(exchange?.search.get('grant_type')).toBe('pkce');
      expect(exchange?.body.auth_code).toBe(AUTH_CODE);
      expect(await s256(String(exchange?.body.code_verifier))).toBe(params.get('code_challenge'));
      expect([...context.session.values.values()].join()).toContain(ACCESS_TOKEN);
      expect(context.captureError).not.toHaveBeenCalled();
    },
  );

  it.each<[string, BrowserAnswer]>([
    ['the user closed the browser', () => ({ type: 'closed' })],
    ['the user declined consent', () => redirectWith('error=access_denied&error_description=x')],
  ])('resolves null when %s, without an exchange', async (_label, answer) => {
    const context = setUp(answer);

    await expect(context.repository.signInWithProvider('google')).resolves.toBeNull();

    expect(log.requests).toStrictEqual([]);
    expect(context.captureError).not.toHaveBeenCalled();
  });

  it.each<[string, BrowserAnswer]>([
    ['a flow id this call did not start', () => codeRedirect(OTHER_FLOW_ID)],
    ['a failed redirect', () => redirectWith('error=server_error&error_code=unexpected_failure')],
    ['a redirect without a code', (flowId) => redirectWith(`sb_flow_id=${flowId}`)],
    [
      'a redirect to another url',
      (flowId) => ({ type: 'redirect', url: `tsuzuki://auth/callback?sb_flow_id=${flowId}` }),
    ],
  ])('rejects %s as oauth-failed, without an exchange', async (_label, answer) => {
    const context = setUp(answer);

    await expect(context.repository.signInWithProvider('google')).rejects.toMatchObject({
      name: 'AuthError',
      reason: 'oauth-failed',
    });

    expect(log.requests).toStrictEqual([]);
    expect(context.captureError).not.toHaveBeenCalled();
  });

  describe('a failed exchange', () => {
    it.each([
      { label: 'a lost connection', respond: () => HttpResponse.error(), reason: 'network' },
      {
        label: 'a code already used',
        respond: () => authErrorResponse(404, 'flow_state_not_found'),
        reason: 'oauth-failed',
      },
      {
        label: 'a rate limit',
        respond: () => authErrorResponse(429, 'over_request_rate_limit'),
        reason: 'oauth-failed',
      },
    ])('rejects $label as $reason, unreported', async ({ respond, reason }) => {
      server.use(log.handler, endpointHandler(PKCE_GRANT, respond));
      const context = setUp(codeRedirect);

      await expect(context.repository.signInWithProvider('google')).rejects.toMatchObject({
        name: 'AuthError',
        reason,
      });

      expect(tokenRequests()).toHaveLength(1);
      expect(context.captureError).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'an unexpected server code',
        respond: () => authErrorResponse(400, 'validation_failed'),
        tags: { operation: 'oauth-sign-in', code: 'validation_failed' },
      },
      {
        label: 'a session without a user id',
        respond: () => HttpResponse.json({ ...createSession(), user: { id: 'not-a-uuid' } }),
        tags: { operation: 'oauth-sign-in' },
      },
    ])('rejects $label as oauth-failed and reports it', async ({ respond, tags }) => {
      server.use(log.handler, endpointHandler(PKCE_GRANT, respond));
      const flowIds: string[] = [];
      const context = setUp((flowId) => {
        flowIds.push(flowId);
        return codeRedirect(flowId);
      });

      const error = await context.repository
        .signInWithProvider('google')
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AuthError', reason: 'oauth-failed' });
      expect(error).not.toHaveProperty('cause');
      expect(context.captureError).toHaveBeenCalledTimes(1);
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'AuthError', reason: 'unknown' }),
        { source: 'auth', tags },
      );
      expectNothingPersonalReported(context.captureError.mock.calls, flowIds);
    });
  });

  describe('a flow that cannot start', () => {
    it('rejects a provider this build does not offer as unknown, before anything', async () => {
      const context = setUp(codeRedirect, ['google']);

      await expect(context.repository.signInWithProvider('apple')).rejects.toMatchObject({
        name: 'AuthError',
        reason: 'unknown',
      });

      expect(context.openAuthSession).not.toHaveBeenCalled();
      expect(context.session.values.size).toBe(0);
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unknown' }),
        OAUTH_REPORT,
      );
    });

    it('offers no provider without the oauth setup', async () => {
      const context = createTestRepository();

      expect(context.repository.oauthProviders).toStrictEqual([]);
      await expect(context.repository.signInWithProvider('google')).rejects.toMatchObject({
        reason: 'unknown',
      });
      expect(context.session.values.size).toBe(0);
    });

    it('offers a frozen copy of the providers given', () => {
      const providers: OAuthProvider[] = ['apple', 'google'];
      const context = setUp(codeRedirect, providers);
      providers.pop();

      expect(context.repository.oauthProviders).toStrictEqual(['apple', 'google']);
      expect(Object.isFrozen(context.repository.oauthProviders)).toBe(true);
    });

    it.each([
      {
        label: 'an error from supabase-js',
        start: () =>
          Promise.resolve({
            data: { provider: 'google' as const, url: null },
            error: new SupabaseAuthError(SERVER_MESSAGE, 500, 'unexpected_failure'),
          }),
        tags: { operation: 'oauth-sign-in', code: 'unexpected_failure' },
      },
      {
        label: 'no flow id',
        start: () =>
          Promise.resolve({
            data: { provider: 'google' as const, url: `${AUTH_URL}/authorize`, flowId: null },
            error: null,
          }),
        tags: { operation: 'oauth-sign-in' },
      },
      {
        label: 'no url',
        start: () =>
          Promise.resolve({
            data: { provider: 'google' as const, url: '', flowId: OTHER_FLOW_ID },
            error: null,
          }),
        tags: { operation: 'oauth-sign-in' },
      },
      {
        label: 'a throw',
        start: () => Promise.reject(new Error(SERVER_MESSAGE)),
        tags: { operation: 'oauth-sign-in' },
      },
    ])('rejects a start with $label as unknown and reports it', async ({ start, tags }) => {
      const context = setUp(codeRedirect);
      jest.spyOn(context.client.auth, 'signInWithOAuth').mockImplementation(start);

      await expect(context.repository.signInWithProvider('google')).rejects.toMatchObject({
        reason: 'unknown',
      });

      expect(context.openAuthSession).not.toHaveBeenCalled();
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unknown' }),
        { source: 'auth', tags },
      );
      expectNothingPersonalReported(context.captureError.mock.calls, [OTHER_FLOW_ID]);
    });

    it('rejects a browser session that cannot open as unknown and reports it', async () => {
      const context = setUp(codeRedirect);
      context.openAuthSession.mockRejectedValue(new Error(`cannot open ${OAUTH_REDIRECT_URL}`));

      await expect(context.repository.signInWithProvider('google')).rejects.toMatchObject({
        reason: 'unknown',
      });

      expect(log.requests).toStrictEqual([]);
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unknown' }),
        OAUTH_REPORT,
      );
      expectNothingPersonalReported(context.captureError.mock.calls, []);
    });
  });
});
