import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { AuthSession } from '../auth-repository';
import {
  ACCESS_TOKEN,
  AUTH_URL,
  CONFIRMATION_URL,
  EMAIL,
  PASSWORD,
  PASSWORD_RESET_URL,
  REFRESH_TOKEN,
  USER_ID,
  createObfuscatedUser,
  createRequestLog,
  createSession,
  createTestRepository,
  createUser,
  flowIdOf,
  successHandlers,
} from './__fixtures__/auth-handlers';

const CAPTCHA_TOKEN = 'captcha-token';
const AUTH_CODE = '6f1c2b0e-8a47-4d52-9a3e-2d1f0c9b7e41';
const UNSTORED_FLOW_ID = 'never-requested-flow';
const SIGNED_IN: AuthSession = { userId: USER_ID };

const redirectPattern = (url: string): RegExp =>
  new RegExp(`^${url.replaceAll('/', '\\/')}\\?sb_flow_id=[A-Za-z0-9_-]{8,64}$`);

// the s256 challenge of a pkce verifier, base64url without padding
const s256 = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};

describe('createSupabaseAuthRepository', () => {
  let log: ReturnType<typeof createRequestLog>;
  let context: ReturnType<typeof createTestRepository>;

  const requestsTo = (path: string) => log.requests.filter((request) => request.path === path);

  // the sessions a listener receives; `first` settles with the initial one
  const subscribe = () => {
    const sessions: (AuthSession | null)[] = [];
    let settleFirst = (): void => undefined;
    const first = new Promise<void>((resolve) => {
      settleFirst = resolve;
    });
    const unsubscribe = context.repository.onAuthStateChange((session) => {
      sessions.push(session);
      settleFirst();
    });
    return { sessions, first, unsubscribe };
  };

  beforeEach(() => {
    log = createRequestLog();
    server.use(log.handler, ...successHandlers());
    context = createTestRepository();
  });

  describe('signUp', () => {
    it('sends the credentials with the confirmation redirect and its flow id', async () => {
      await expect(
        context.repository.signUp({ email: EMAIL, password: PASSWORD }),
      ).resolves.toBeUndefined();

      const [request] = requestsTo('/signup');
      expect(request?.body).toMatchObject({ email: EMAIL, password: PASSWORD });
      expect(request?.search.get('redirect_to')).toMatch(redirectPattern(CONFIRMATION_URL));
    });

    it('sends the captcha token only when given', async () => {
      await context.repository.signUp({ email: EMAIL, password: PASSWORD });
      await context.repository.signUp(
        { email: EMAIL, password: PASSWORD },
        { captchaToken: CAPTCHA_TOKEN },
      );

      const [withoutToken, withToken] = requestsTo('/signup');
      expect(withoutToken?.body.gotrue_meta_security).toStrictEqual({});
      expect(withToken?.body.gotrue_meta_security).toStrictEqual({ captcha_token: CAPTCHA_TOKEN });
    });

    it('resolves the same way for a registered email', async () => {
      server.use(http.post(`${AUTH_URL}/signup`, () => HttpResponse.json(createObfuscatedUser())));

      await expect(
        context.repository.signUp({ email: EMAIL, password: PASSWORD }),
      ).resolves.toBeUndefined();
    });
  });

  it('resends the confirmation email with a new flow id, the captcha token when given', async () => {
    await context.repository.resendConfirmation(EMAIL, { captchaToken: CAPTCHA_TOKEN });

    const [request] = requestsTo('/resend');
    expect(request?.body).toMatchObject({
      email: EMAIL,
      type: 'signup',
      gotrue_meta_security: { captcha_token: CAPTCHA_TOKEN },
    });
    expect(request?.search.get('redirect_to')).toMatch(redirectPattern(CONFIRMATION_URL));
  });

  it('requests the recovery email with the reset redirect and its flow id', async () => {
    await expect(context.repository.requestPasswordReset(EMAIL)).resolves.toBeUndefined();

    const [request] = requestsTo('/recover');
    expect(request?.body).toMatchObject({ email: EMAIL, gotrue_meta_security: {} });
    expect(request?.body.gotrue_meta_security).not.toHaveProperty('captcha_token');
    expect(request?.search.get('redirect_to')).toMatch(redirectPattern(PASSWORD_RESET_URL));
  });

  it('signs in with the credentials and the captcha token, keeping the user id only', async () => {
    await expect(
      context.repository.signIn({ email: EMAIL, password: PASSWORD }, { captchaToken: 'token' }),
    ).resolves.toStrictEqual(SIGNED_IN);

    const [request] = requestsTo('/token');
    expect(request?.search.get('grant_type')).toBe('password');
    expect(request?.body).toMatchObject({
      email: EMAIL,
      password: PASSWORD,
      gotrue_meta_security: { captcha_token: 'token' },
    });
  });

  describe('completeEmailLink', () => {
    it('exchanges the code with the verifier stored for the link flow id', async () => {
      await context.repository.signUp({ email: EMAIL, password: PASSWORD });
      await context.repository.resendConfirmation(EMAIL);
      const [signUp] = requestsTo('/signup');
      const [resend] = requestsTo('/resend');
      const signUpFlowId = flowIdOf(signUp?.search.get('redirect_to') ?? null);
      expect(flowIdOf(resend?.search.get('redirect_to') ?? null)).not.toBe(signUpFlowId);

      // the older link: its own verifier, not the one of the latest request
      await expect(
        context.repository.completeEmailLink({ code: AUTH_CODE, flowId: signUpFlowId }),
      ).resolves.toStrictEqual(SIGNED_IN);

      const [exchange] = requestsTo('/token');
      expect(exchange?.search.get('grant_type')).toBe('pkce');
      expect(exchange?.body.auth_code).toBe(AUTH_CODE);
      expect(signUp?.body.code_challenge_method).toBe('s256');
      expect(await s256(String(exchange?.body.code_verifier))).toBe(signUp?.body.code_challenge);
      expect([...context.session.values.values()].join()).toContain(ACCESS_TOKEN);
    });

    it('rejects a link without a verifier on this device as link-invalid, sending nothing', async () => {
      await expect(
        context.repository.completeEmailLink({ code: AUTH_CODE, flowId: UNSTORED_FLOW_ID }),
      ).rejects.toMatchObject({ name: 'AuthError', reason: 'link-invalid' });

      expect(log.requests).toStrictEqual([]);
      expect(context.captureError).not.toHaveBeenCalled();
    });
  });

  it('updates the password of the signed-in user', async () => {
    await context.repository.signIn({ email: EMAIL, password: PASSWORD });

    await expect(context.repository.updatePassword('new-password-1')).resolves.toBeUndefined();

    const [request] = requestsTo('/user');
    expect(request?.method).toBe('PUT');
    expect(request?.body).toMatchObject({ password: 'new-password-1' });
  });

  describe('signOut', () => {
    it('signs out this device only', async () => {
      await context.repository.signIn({ email: EMAIL, password: PASSWORD });

      await expect(context.repository.signOut()).resolves.toBeUndefined();

      expect(requestsTo('/logout')[0]?.search.get('scope')).toBe('local');
      expect(context.session.values.size).toBe(0);
    });

    it('resolves offline once the session is removed from the device', async () => {
      await context.repository.signIn({ email: EMAIL, password: PASSWORD });
      const subscription = subscribe();
      await subscription.first;
      server.use(http.post(`${AUTH_URL}/logout`, () => HttpResponse.error()));

      await expect(context.repository.signOut()).resolves.toBeUndefined();

      const stored = [...context.session.values.values()].join();
      expect(stored).not.toContain(ACCESS_TOKEN);
      expect(stored).not.toContain(REFRESH_TOKEN);
      expect(subscription.sessions).toStrictEqual([SIGNED_IN, null]);
      expect(context.captureError).not.toHaveBeenCalled();
    });
  });

  describe('onAuthStateChange', () => {
    it('gives the current session first, then every change, until unsubscribed', async () => {
      const subscription = subscribe();
      await subscription.first;

      await context.repository.signIn({ email: EMAIL, password: PASSWORD });
      subscription.unsubscribe();
      await context.repository.signOut();

      expect(subscription.sessions).toStrictEqual([null, SIGNED_IN]);
    });

    it('reads a session without a valid user id as signed out and reports it', async () => {
      server.use(
        http.post(`${AUTH_URL}/token`, () =>
          HttpResponse.json({ ...createSession(), user: createUser('not-a-uuid') }),
        ),
      );
      const subscription = subscribe();
      await subscription.first;

      await expect(
        context.repository.signIn({ email: EMAIL, password: PASSWORD }),
      ).rejects.toMatchObject({ reason: 'unknown' });

      expect(subscription.sessions).toStrictEqual([null, null]);
      expect(context.captureError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unknown' }),
        { source: 'auth', tags: { operation: 'session' } },
      );
    });
  });

  it('starts and stops the token auto refresh', () => {
    const start = jest.spyOn(context.client.auth, 'startAutoRefresh').mockResolvedValue();
    const stop = jest.spyOn(context.client.auth, 'stopAutoRefresh').mockResolvedValue();

    context.repository.setAutoRefresh(true);
    context.repository.setAutoRefresh(false);

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected auto refresh failure', async () => {
    jest.spyOn(context.client.auth, 'startAutoRefresh').mockRejectedValue(new Error('timer'));

    context.repository.setAutoRefresh(true);
    await Promise.resolve();

    expect(context.captureError).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'AuthError', reason: 'unknown' }),
      { source: 'auth', tags: { operation: 'auto-refresh' } },
    );
  });
});
