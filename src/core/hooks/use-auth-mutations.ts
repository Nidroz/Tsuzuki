import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import type {
  AuthRequestOptions,
  CaptchaAction,
  CaptchaTokenProvider,
  EmailCredentials,
  EmailLinkCode,
  OAuthProvider,
} from '../repositories/auth-repository';
import { useAuthContext } from './use-auth-context';

// the auth actions (docs/ARCHITECTURE.md §8, ADR-0014): one mutation per action over the
// AuthRepository of the context. the variables hold passwords: a mutation never pauses offline
// (networkMode always: an offline call fails at once with `network`) and is dropped as soon as no
// screen observes it (gcTime 0); the persister never stores mutations. rejections are AuthError

const AUTH_MUTATION_OPTIONS = { networkMode: 'always', gcTime: 0 } as const;

// a protected call asks the captcha provider for a token first, and sends it only when there is
// one: null means the captcha is disabled
const withCaptcha = async <T>(
  captcha: CaptchaTokenProvider,
  action: CaptchaAction,
  call: (options?: AuthRequestOptions) => Promise<T>,
): Promise<T> => {
  const captchaToken = await captcha.getToken(action);
  return captchaToken === null ? call() : call({ captchaToken });
};

/** creates an account and sends the confirmation email; resolves the same for a registered email */
export const useSignUp = () => {
  const { repository, captcha } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (credentials: EmailCredentials) =>
      withCaptcha(captcha, 'sign-up', (options) => repository.signUp(credentials, options)),
  });
};

/** sends the confirmation email again to `email` */
export const useResendConfirmation = () => {
  const { repository, captcha } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (email: string) =>
      withCaptcha(captcha, 'resend-confirmation', (options) =>
        repository.resendConfirmation(email, options),
      ),
  });
};

/** signs in with a confirmed account; resolves to the session */
export const useSignIn = () => {
  const { repository, captcha } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (credentials: EmailCredentials) =>
      withCaptcha(captcha, 'sign-in', (options) => repository.signIn(credentials, options)),
  });
};

/** sends the recovery email to `email`; resolves for an unknown email too */
export const useRequestPasswordReset = () => {
  const { repository, captcha } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (email: string) =>
      withCaptcha(captcha, 'password-reset', (options) =>
        repository.requestPasswordReset(email, options),
      ),
  });
};

/**
 * exchanges the code of a confirmation link for a session: called on the user's Continue, never
 * when the link opens (ADR-0014)
 */
export const useCompleteEmailLink = () => {
  const { repository } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (link: EmailLinkCode) => repository.completeEmailLink(link),
  });
};

/** the new password of a recovery link, already validated by newPasswordFormSchema */
export interface PasswordResetVariables {
  readonly link: EmailLinkCode;
  readonly password: string;
}

/**
 * the step of a password reset that failed: the code exchange (the link is spent, whatever the
 * reason) or the password update (the user is signed in with the recovery session, a retry sets
 * the password only)
 */
export type PasswordResetStep = 'exchange' | 'update';

/**
 * completes a recovery link on submit of a valid new password: exchanges its code once, then sets
 * the password. once the exchange succeeded, the user is signed in with the recovery session, so a
 * retry after a failed update (a weak or same password, the network) sets the password only: the
 * code is single-use. `failedStep` tells which step the current error comes from, null without an
 * error
 */
export const useCompletePasswordReset = () => {
  const { repository } = useAuthContext();
  // the code this hook already exchanged: the ref decides the next call, the state the render
  const exchangedCodeRef = useRef<string | null>(null);
  const [exchangedCode, setExchangedCode] = useState<string | null>(null);
  const mutation = useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: async ({ link, password }: PasswordResetVariables) => {
      if (exchangedCodeRef.current !== link.code) {
        await repository.completeEmailLink(link);
        exchangedCodeRef.current = link.code;
        setExchangedCode(link.code);
      }
      await repository.updatePassword(password);
    },
  });
  // an error after the exchange of the code of the failed call can only come from the update
  const failedStep: PasswordResetStep | null = mutation.isError
    ? exchangedCode === mutation.variables.link.code
      ? 'update'
      : 'exchange'
    : null;
  return { ...mutation, failedStep };
};

/**
 * signs in with an identity provider (ADR-0015): the browser auth session, then the code exchange,
 * all inside the user's tap. resolves the session, or null when the user closed the browser or
 * declined consent. no captcha: supabase does not protect the authorize endpoint
 */
export const useSignInWithProvider = () => {
  const { repository } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: (provider: OAuthProvider) => repository.signInWithProvider(provider),
  });
};

/** signs out on this device (local scope); rejects with `network` when the session must stay */
export const useSignOut = () => {
  const { repository } = useAuthContext();
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: () => repository.signOut(),
  });
};
