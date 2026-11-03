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

/** the translation key of a failed account deletion; anything else than an AccountDeletionError reads as `unknown` */
export const accountDeletionErrorKey = (
  error: unknown,
): (typeof ACCOUNT_DELETION_ERROR_KEYS)[AccountDeletionErrorReason] =>
  ACCOUNT_DELETION_ERROR_KEYS[isAccountDeletionError(error) ? error.reason : 'unknown'];
