import { describe, expect, it } from '@jest/globals';

import {
  ACCOUNT_DELETION_ERROR_REASONS,
  AccountDeletionError,
  isAccountDeletionError,
} from './account-deletion-errors';

describe('AccountDeletionError', () => {
  it('lists the reasons', () => {
    expect(ACCOUNT_DELETION_ERROR_REASONS).toStrictEqual([
      'offline',
      'network',
      'session-expired',
      'unknown',
    ]);
  });

  it.each(ACCOUNT_DELETION_ERROR_REASONS)('keeps the %s reason, and only it', (reason) => {
    const error = new AccountDeletionError(reason);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AccountDeletionError');
    expect(error.reason).toBe(reason);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'reason']);
  });

  it('gives each reason its own fixed message', () => {
    const messages = ACCOUNT_DELETION_ERROR_REASONS.map(
      (reason) => new AccountDeletionError(reason).message,
    );

    expect(new Set(messages).size).toBe(ACCOUNT_DELETION_ERROR_REASONS.length);
    expect(new AccountDeletionError('network').message).toBe(
      'Account deletion service unreachable',
    );
  });

  it('tells an AccountDeletionError from other errors', () => {
    expect(isAccountDeletionError(new AccountDeletionError('unknown'))).toBe(true);
    expect(isAccountDeletionError(new Error('Account deletion failed'))).toBe(false);
    expect(isAccountDeletionError({ name: 'AccountDeletionError', reason: 'unknown' })).toBe(false);
  });
});
