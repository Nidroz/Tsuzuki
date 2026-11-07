import {
  ACCOUNT_DELETION_ERROR_REASONS,
  AccountDeletionError,
} from '@core/errors/account-deletion-errors';
import { describe, expect, it } from '@jest/globals';

import {
  accountDeletionErrorKey,
  signedOutAccountDeletionErrorKey,
} from './account-deletion-error-keys';

// per R-03: the signed-out state words an ended session for a user signed out already; every
// other reason keeps the wording of the form

describe('signedOutAccountDeletionErrorKey', () => {
  it('words an ended session for a signed-out user, the form keeping its own wording', () => {
    const error = new AccountDeletionError('session-expired');

    expect(signedOutAccountDeletionErrorKey(error)).toBe(
      'settings.deleteAccount.signedOut.sessionExpired',
    );
    expect(accountDeletionErrorKey(error)).toBe('settings.deleteAccount.errors.sessionExpired');
  });

  it.each(ACCOUNT_DELETION_ERROR_REASONS.filter((reason) => reason !== 'session-expired'))(
    'keeps the key of the form for %s',
    (reason) => {
      const error = new AccountDeletionError(reason);

      expect(signedOutAccountDeletionErrorKey(error)).toBe(accountDeletionErrorKey(error));
    },
  );

  it('reads anything else than an AccountDeletionError as unknown', () => {
    expect(signedOutAccountDeletionErrorKey(new Error('boom'))).toBe(
      'settings.deleteAccount.errors.unknown',
    );
  });
});
