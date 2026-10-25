import { isAuthError, type AuthErrorReason } from '@core/errors/auth-errors';
import type { TranslationKey } from '@core/i18n/index';

/** the translation key of each auth error reason: what the user can do about it */
export const AUTH_ERROR_KEYS = {
  'invalid-credentials': 'auth.errors.invalidCredentials',
  'invalid-email': 'auth.errors.invalidEmail',
  'email-not-confirmed': 'auth.errors.emailNotConfirmed',
  'weak-password': 'auth.errors.weakPassword',
  'same-password': 'auth.errors.samePassword',
  'rate-limited': 'auth.errors.rateLimited',
  'captcha-failed': 'auth.errors.captchaFailed',
  'link-invalid': 'auth.errors.linkInvalid',
  'oauth-failed': 'auth.errors.oauthFailed',
  network: 'auth.errors.network',
  unknown: 'auth.errors.unknown',
} as const satisfies Record<AuthErrorReason, TranslationKey>;

/** the reason of a failed auth call; anything that is not an AuthError reads as `unknown` */
export const authErrorReason = (error: unknown): AuthErrorReason =>
  isAuthError(error) ? error.reason : 'unknown';

/** the translation key of a failed auth call's error */
export const authErrorKey = (error: unknown): (typeof AUTH_ERROR_KEYS)[AuthErrorReason] =>
  AUTH_ERROR_KEYS[authErrorReason(error)];

/** whether a failed auth call rejected the email address: the email field shows it */
export const rejectsEmail = (error: unknown): boolean => authErrorReason(error) === 'invalid-email';
