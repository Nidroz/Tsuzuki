import { isAuthError, type AuthErrorReason } from '../errors/auth-errors';
import type { ErrorReporter } from '../errors/error-reporter';

// the step tag of a local sign out that rejected
const SIGN_OUT_STEP = 'sign-out';
// the reason tag of a local sign out that rejected with something else than an AuthError
const UNKNOWN_REASON = 'unknown';
// the AuthError reason the auth repository reports itself: reporting it here would report it twice
const REPOSITORY_REPORTED_REASON: AuthErrorReason = 'unknown';

/**
 * reports a local sign out that rejected after the account was deleted or reported gone, where
 * the flow goes on (ADR-0018): `{ source, tags: { step: 'sign-out', reason } }`, unless it is the
 * AuthError `unknown` the auth repository already reported (AuthRepository.signOut). an AuthError
 * holds a fixed message per reason, nothing personal
 */
export const reportSignOutFailure = (
  reporter: ErrorReporter,
  source: string,
  error: unknown,
): void => {
  if (isAuthError(error) && error.reason === REPOSITORY_REPORTED_REASON) {
    return;
  }
  reporter.captureError(error, {
    source,
    tags: { step: SIGN_OUT_STEP, reason: isAuthError(error) ? error.reason : UNKNOWN_REASON },
  });
};
