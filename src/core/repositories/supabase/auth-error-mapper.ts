import {
  isAuthError as isSupabaseAuthError,
  isAuthPKCECodeVerifierMissingError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js';

import { AuthError, type AuthErrorReason } from '../../errors/auth-errors';
import type { ErrorContext } from '../../errors/error-reporter';

// supabase auth errors to AuthError reasons (docs/ARCHITECTURE.md §4). the supabase error itself
// never leaves this module: its message is server text and may hold the email

/** the auth calls, as named in reports. */
export type AuthOperation =
  | 'sign-up'
  | 'resend-confirmation'
  | 'sign-in'
  | 'password-reset'
  | 'complete-email-link'
  | 'oauth-sign-in'
  | 'update-password'
  | 'sign-out'
  | 'session'
  | 'auto-refresh';

/** the `source` of every auth report. */
export const AUTH_REPORT_SOURCE = 'auth';

const HTTP_TOO_MANY_REQUESTS = 429;

// a map, so a code such as `constructor` never reads an object prototype member
const REASON_BY_CODE: ReadonlyMap<string, AuthErrorReason> = new Map<string, AuthErrorReason>([
  ['invalid_credentials', 'invalid-credentials'],
  // gotrue's address check is not z.email(): an address the form accepts can still fail it
  ['email_address_invalid', 'invalid-email'],
  ['email_not_confirmed', 'email-not-confirmed'],
  ['weak_password', 'weak-password'],
  ['same_password', 'same-password'],
  ['over_email_send_rate_limit', 'rate-limited'],
  ['over_request_rate_limit', 'rate-limited'],
  ['captcha_failed', 'captcha-failed'],
  ['flow_state_not_found', 'link-invalid'],
  ['flow_state_expired', 'link-invalid'],
  ['bad_code_verifier', 'link-invalid'],
]);

// a server-defined identifier only: anything else could be free text
const REPORTABLE_CODE = /^[a-z0-9_]{1,64}$/;

/** the reason of a failed supabase auth call; anything that is not a supabase auth error is unknown. */
export const authErrorReason = (error: unknown): AuthErrorReason => {
  if (!isSupabaseAuthError(error)) {
    return 'unknown';
  }
  if (isAuthPKCECodeVerifierMissingError(error)) {
    return 'link-invalid';
  }
  if (isAuthRetryableFetchError(error)) {
    return 'network';
  }
  const byCode = error.code === undefined ? undefined : REASON_BY_CODE.get(error.code);
  if (byCode !== undefined) {
    return byCode;
  }
  return error.status === HTTP_TOO_MANY_REQUESTS ? 'rate-limited' : 'unknown';
};

/** the AuthError of a failed supabase auth call. */
export const toAuthError = (error: unknown): AuthError => new AuthError(authErrorReason(error));

/** the report context of an unknown failure: the operation, and the supabase error code if any. */
export const authReportContext = (operation: AuthOperation, error: unknown): ErrorContext => {
  const code = isSupabaseAuthError(error) ? error.code : undefined;
  return {
    source: AUTH_REPORT_SOURCE,
    tags: code !== undefined && REPORTABLE_CODE.test(code) ? { operation, code } : { operation },
  };
};
