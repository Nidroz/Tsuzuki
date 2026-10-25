import { describe, expect, it } from '@jest/globals';

import { AUTH_ERROR_REASONS, AuthError, isAuthError } from './auth-errors';

describe('AuthError', () => {
  it('keeps the reason, and only the reason', () => {
    const error = new AuthError('email-not-confirmed');

    expect(error.name).toBe('AuthError');
    expect(error.reason).toBe('email-not-confirmed');
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'reason']);
  });

  it('gives each reason its own fixed message', () => {
    const messages = AUTH_ERROR_REASONS.map((reason) => new AuthError(reason).message);

    expect(new Set(messages).size).toBe(AUTH_ERROR_REASONS.length);
    expect(new AuthError('network').message).toBe('Auth service unreachable');
  });

  it('tells an AuthError from other errors', () => {
    expect(isAuthError(new AuthError('unknown'))).toBe(true);
    expect(isAuthError(new Error('Auth request failed'))).toBe(false);
    expect(isAuthError({ name: 'AuthError', reason: 'unknown' })).toBe(false);
  });
});
