import { AUTH_ERROR_REASONS, AuthError } from '@core/errors/auth-errors';
import { describe, expect, it } from '@jest/globals';

import { AUTH_ERROR_KEYS, authErrorKey, authErrorReason } from './auth-error-keys';

describe('authErrorKey', () => {
  // the keys are typed against the catalogs: typecheck rejects a key missing from en.json
  it.each(AUTH_ERROR_REASONS)('translates the %s reason with its own key', (reason) => {
    const error = new AuthError(reason);

    expect(authErrorReason(error)).toBe(reason);
    expect(authErrorKey(error)).toBe(AUTH_ERROR_KEYS[reason]);
  });

  it('gives each reason its own text', () => {
    const keys = AUTH_ERROR_REASONS.map((reason) => AUTH_ERROR_KEYS[reason]);

    expect(new Set(keys).size).toBe(AUTH_ERROR_REASONS.length);
  });

  it.each([
    ['a plain error', new Error('Invalid login credentials')],
    ['a string', 'network'],
    ['nothing', null],
  ])('reads %s as unknown', (_case, error) => {
    expect(authErrorReason(error)).toBe('unknown');
    expect(authErrorKey(error)).toBe('auth.errors.unknown');
  });
});
