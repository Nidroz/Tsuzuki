// errors of the auth repository (docs/ARCHITECTURE.md §4, ADR-0014). they reach the screens, which
// translate the reason, and the error reporter for `unknown`: the message is fixed per reason and
// never holds an email, a password, a code, a token or a server text, and no cause is attached

/**
 * what the user can do about a failed auth call: fix the credentials, confirm the email, choose
 * another password, wait, retry the captcha, ask for a new link, check the connection, or retry.
 */
export const AUTH_ERROR_REASONS = [
  'invalid-credentials',
  'email-not-confirmed',
  'weak-password',
  'same-password',
  'rate-limited',
  'captcha-failed',
  'link-invalid',
  'network',
  'unknown',
] as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorReason, string>> = {
  'invalid-credentials': 'Invalid email or password',
  'email-not-confirmed': 'Email not confirmed',
  'weak-password': 'Password does not meet the policy',
  'same-password': 'New password equals the current one',
  'rate-limited': 'Too many auth requests',
  'captcha-failed': 'Captcha verification failed',
  'link-invalid': 'Email link is invalid, expired or already used',
  network: 'Auth service unreachable',
  unknown: 'Auth request failed',
};

/** a failed auth call; it holds the reason only. */
export class AuthError extends Error {
  readonly reason: AuthErrorReason;

  constructor(reason: AuthErrorReason) {
    super(AUTH_ERROR_MESSAGES[reason]);
    this.name = 'AuthError';
    this.reason = reason;
  }
}

/** whether `error` is an AuthError of this module (screens read anything else as `unknown`). */
export const isAuthError = (error: unknown): error is AuthError => error instanceof AuthError;
