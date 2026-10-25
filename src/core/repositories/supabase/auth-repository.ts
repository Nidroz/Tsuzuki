import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AuthError, type AuthErrorReason } from '../../errors/auth-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import { parseOAuthRedirect } from '../../schemas/oauth-redirect';
import type {
  AuthRepository,
  AuthRequestOptions,
  AuthSession,
  OAuthBrowser,
  OAuthProvider,
} from '../auth-repository';
import { authReportContext, toAuthError, type AuthOperation } from './auth-error-mapper';
import type { Database } from './database.types';

// the AuthRepository over supabase auth (docs/ARCHITECTURE.md §4, §8, ADR-0014, ADR-0015). the
// client is created with pkce and appendPkceFlowIdToRedirects (create-supabase-client.ts), so every
// email link and provider redirect carries its flow id back. nothing here reads `user.identities`
// or any user field but the id, and no url, code or flow id is ever logged or reported

/** the provider sign in setup of a build (ADR-0015); without it no provider is offered. */
export interface SupabaseOAuthOptions {
  readonly browser: OAuthBrowser;
  /** the providers this build signs in with, in display order. */
  readonly providers: readonly OAuthProvider[];
  /** the url the provider sign in redirects to (tsuzuki://auth/oauth-callback on mobile). */
  readonly redirectUrl: string;
}

export interface SupabaseAuthRepositoryOptions {
  /** the url the confirmation email opens (tsuzuki://auth/callback on mobile). */
  readonly confirmationRedirectUrl: string;
  /** the url the recovery email opens (tsuzuki://auth/reset-password on mobile). */
  readonly passwordResetRedirectUrl: string;
  readonly reporter: ErrorReporter;
  readonly oauth?: SupabaseOAuthOptions;
}

const OAUTH_OPERATION: AuthOperation = 'oauth-sign-in';
// the reasons of a failed provider code exchange the user can act on as such (check the connection,
// wait); any other becomes `oauth-failed`
const OAUTH_EXCHANGE_REASONS: ReadonlySet<AuthErrorReason> = new Set(['network', 'rate-limited']);

// a session from supabase-js, read for its user id only
const sessionUserSchema = z.object({ user: z.object({ id: z.uuid() }) });

// the captcha token goes only when there is one: supabase rejects an empty token once enabled
const captchaOptions = (options?: AuthRequestOptions): { captchaToken?: string } =>
  options?.captchaToken === undefined ? {} : { captchaToken: options.captchaToken };

// supabase-js returns its auth errors: rethrown here, mapped by `run`
const throwIfFailed = ({ error }: { error: Error | null }): void => {
  if (error !== null) {
    throw error;
  }
};

/** the AuthRepository over the supabase client; the redirect urls are given by the composition root. */
export const createSupabaseAuthRepository = (
  client: SupabaseClient<Database>,
  {
    confirmationRedirectUrl,
    passwordResetRedirectUrl,
    reporter,
    oauth,
  }: SupabaseAuthRepositoryOptions,
): AuthRepository => {
  const { auth } = client;
  const oauthProviders: readonly OAuthProvider[] = Object.freeze([...(oauth?.providers ?? [])]);

  // the AuthError of a failure; only `unknown` is reported, the other reasons are user errors
  const fail = (operation: AuthOperation, error: unknown): AuthError => {
    const authError = toAuthError(error);
    if (authError.reason === 'unknown') {
      reporter.captureError(authError, authReportContext(operation, error));
    }
    return authError;
  };

  const run = async <T>(operation: AuthOperation, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw fail(operation, error);
    }
  };

  const toAuthSession = (session: unknown): AuthSession | null => {
    const parsed = sessionUserSchema.safeParse(session);
    return parsed.success ? { userId: parsed.data.user.id } : null;
  };

  // the session of a call that signs in: a session without a user id is a server fault
  const signedIn = (session: unknown): AuthSession => {
    const authSession = toAuthSession(session);
    if (authSession === null) {
      throw new AuthError('unknown');
    }
    return authSession;
  };

  // a provider sign in that cannot start or run: reported as unknown, whatever its cause
  const oauthUnknown = (error: unknown): AuthError => {
    const authError = new AuthError('unknown');
    reporter.captureError(authError, authReportContext(OAUTH_OPERATION, error));
    return authError;
  };

  const oauthStep = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      throw oauthUnknown(error);
    }
  };

  // the code of the redirect, exchanged with the verifier of this call's flow
  const exchangeOAuthCode = async (code: string, flowId: string): Promise<AuthSession> => {
    try {
      const result = await auth.exchangeCodeForSession(code, { flowId });
      throwIfFailed(result);
      return signedIn(result.data.session);
    } catch (error) {
      // supabase-js removes the verifier on every failed exchange: a retry is a new flow. an
      // unknown cause is still reported
      const { reason } = fail(OAUTH_OPERATION, error);
      throw new AuthError(OAUTH_EXCHANGE_REASONS.has(reason) ? reason : 'oauth-failed');
    }
  };

  return {
    signUp: ({ email, password }, options) =>
      run('sign-up', async () => {
        throwIfFailed(
          await auth.signUp({
            email,
            password,
            options: { emailRedirectTo: confirmationRedirectUrl, ...captchaOptions(options) },
          }),
        );
      }),

    resendConfirmation: (email, options) =>
      run('resend-confirmation', async () => {
        throwIfFailed(
          await auth.resend({
            type: 'signup',
            email,
            options: { emailRedirectTo: confirmationRedirectUrl, ...captchaOptions(options) },
          }),
        );
      }),

    signIn: ({ email, password }, options) =>
      run('sign-in', async () => {
        const result = await auth.signInWithPassword({
          email,
          password,
          options: captchaOptions(options),
        });
        throwIfFailed(result);
        return signedIn(result.data.session);
      }),

    oauthProviders,

    signInWithProvider: async (provider) => {
      if (oauth === undefined || !oauthProviders.includes(provider)) {
        throw oauthUnknown(null);
      }
      const { browser, redirectUrl } = oauth;
      // builds the authorize url locally and stores the verifier in this flow's slot
      const { data, error } = await oauthStep(() =>
        auth.signInWithOAuth({
          provider,
          options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
        }),
      );
      if (error !== null) {
        throw oauthUnknown(error);
      }
      const { url, flowId } = data;
      if (url === '' || typeof flowId !== 'string') {
        throw oauthUnknown(null);
      }
      const session = await oauthStep(() => browser.openAuthSession(url, redirectUrl));
      if (session.type === 'closed') {
        return null;
      }
      const redirect = parseOAuthRedirect(session.url, redirectUrl);
      if (redirect.kind === 'declined') {
        return null;
      }
      // a redirect this call did not start (another flow, a forged page) is never exchanged
      if (redirect.kind === 'failed' || redirect.link.flowId !== flowId) {
        throw new AuthError('oauth-failed');
      }
      return exchangeOAuthCode(redirect.link.code, flowId);
    },

    requestPasswordReset: (email, options) =>
      run('password-reset', async () => {
        throwIfFailed(
          await auth.resetPasswordForEmail(email, {
            redirectTo: passwordResetRedirectUrl,
            ...captchaOptions(options),
          }),
        );
      }),

    completeEmailLink: async ({ code, flowId }) => {
      try {
        // the flow id selects this link's verifier; a missing one rejects before any request
        const result = await auth.exchangeCodeForSession(code, { flowId });
        throwIfFailed(result);
        return signedIn(result.data.session);
      } catch (error) {
        // supabase-js removes the verifier on every failed exchange, a lost connection or a server
        // error included: the link can never be tried again. an unknown cause is still reported
        fail('complete-email-link', error);
        throw new AuthError('link-invalid');
      }
    },

    updatePassword: (newPassword) =>
      run('update-password', async () => {
        throwIfFailed(await auth.updateUser({ password: newPassword }));
      }),

    signOut: () =>
      run('sign-out', async () => {
        const { error } = await auth.signOut({ scope: 'local' });
        if (error === null) {
          return;
        }
        // the server could not revoke the session (offline): supabase-js removes it from the
        // device anyway, unless it could not read it. resolve once it is gone
        const { data, error: sessionError } = await auth.getSession();
        if (sessionError !== null || data.session !== null) {
          throw error;
        }
        fail('sign-out', error);
      }),

    onAuthStateChange: (listener) => {
      // synchronous: the callback only maps and forwards the session; async work belongs to the
      // hooks that listen
      const {
        data: { subscription },
      } = auth.onAuthStateChange((_event, session) => {
        const authSession = session === null ? null : toAuthSession(session);
        if (session !== null && authSession === null) {
          reporter.captureError(new AuthError('unknown'), authReportContext('session', null));
        }
        listener(authSession);
      });
      return () => {
        subscription.unsubscribe();
      };
    },

    setAutoRefresh: (active) => {
      const toggle = active ? auth.startAutoRefresh() : auth.stopAutoRefresh();
      // an expected failure (network) needs no action: the next foreground starts it again
      toggle.catch((error: unknown) => {
        fail('auto-refresh', error);
      });
    },
  };
};
