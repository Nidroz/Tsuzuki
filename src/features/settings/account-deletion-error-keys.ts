import {
  isAccountDeletionError,
  type AccountDeletionErrorReason,
} from '@core/errors/account-deletion-errors';
import type { TranslationKey } from '@core/i18n/index';

/** the translation key of each account deletion error reason: what the user can do about it */
export const ACCOUNT_DELETION_ERROR_KEYS = {
  offline: 'settings.deleteAccount.errors.offline',
  network: 'settings.deleteAccount.errors.network',
  'session-expired': 'settings.deleteAccount.errors.sessionExpired',
  unknown: 'settings.deleteAccount.errors.unknown',
} as const satisfies Record<AccountDeletionErrorReason, TranslationKey>;

/**
 * the keys of the signed-out state, where the user is signed out already: an ended session says
 * the deletion may not have happened and to sign in to check, instead of asking to sign out
 */
export const SIGNED_OUT_ACCOUNT_DELETION_ERROR_KEYS = {
  ...ACCOUNT_DELETION_ERROR_KEYS,
  'session-expired': 'settings.deleteAccount.signedOut.sessionExpired',
} as const satisfies Record<AccountDeletionErrorReason, TranslationKey>;

const reasonOf = (error: unknown): AccountDeletionErrorReason =>
  isAccountDeletionError(error) ? error.reason : 'unknown';

/** the translation key of a failed account deletion; anything else than an AccountDeletionError reads as `unknown` */
export const accountDeletionErrorKey = (
  error: unknown,
): (typeof ACCOUNT_DELETION_ERROR_KEYS)[AccountDeletionErrorReason] =>
  ACCOUNT_DELETION_ERROR_KEYS[reasonOf(error)];

/** the translation key of a failed account deletion shown in the signed-out state */
export const signedOutAccountDeletionErrorKey = (
  error: unknown,
): (typeof SIGNED_OUT_ACCOUNT_DELETION_ERROR_KEYS)[AccountDeletionErrorReason] =>
  SIGNED_OUT_ACCOUNT_DELETION_ERROR_KEYS[reasonOf(error)];
