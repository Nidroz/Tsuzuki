import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AuthError } from '../../errors/auth-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import type { AuthRepository, AuthRequestOptions, AuthSession } from '../auth-repository';
import { authReportContext, toAuthError, type AuthOperation } from './auth-error-mapper';
import type { Database } from './database.types';

// the AuthRepository over supabase auth (docs/ARCHITECTURE.md §4, §8, ADR-0014). the client is
// created with pkce and appendPkceFlowIdToRedirects (create-supabase-client.ts), so every email
// link carries its flow id back. nothing here reads `user.identities` or any user field but the id

export interface SupabaseAuthRepositoryOptions {
  /** the url the confirmation email opens (tsuzuki://auth/callback on mobile). */
  readonly confirmationRedirectUrl: string;
  /** the url the recovery email opens (tsuzuki://auth/reset-password on mobile). */
  readonly passwordResetRedirectUrl: string;
  readonly reporter: ErrorReporter;
}

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
  { confirmationRedirectUrl, passwordResetRedirectUrl, reporter }: SupabaseAuthRepositoryOptions,
): AuthRepository => {
  const { auth } = client;

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

    requestPasswordReset: (email, options) =>
      run('password-reset', async () => {
        throwIfFailed(
          await auth.resetPasswordForEmail(email, {
            redirectTo: passwordResetRedirectUrl,
            ...captchaOptions(options),
          }),
        );
      }),

    completeEmailLink: ({ code, flowId }) =>
      run('complete-email-link', async () => {
        // the flow id selects this link's verifier; a missing one rejects before any request
        const result = await auth.exchangeCodeForSession(code, { flowId });
        throwIfFailed(result);
        return signedIn(result.data.session);
      }),

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
      // synchronous: supabase-js deadlocks when its callback awaits another auth call
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
