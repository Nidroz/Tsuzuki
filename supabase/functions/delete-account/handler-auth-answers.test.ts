import { describe, expect, it } from '@jest/globals';
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js';

import {
  BAD_JWT,
  SERVER_TEXT,
  SESSION_MISSING,
  USER_ID,
  USER_NOT_FOUND,
  VERIFIED,
  authFails,
} from './__fixtures__/auth-answers';
import { toDeletionOutcome, toVerifiedUser } from './handler';

describe('toVerifiedUser', () => {
  it('verifies the user the auth server returned', () => {
    expect(toVerifiedUser({ data: { user: { id: USER_ID } }, error: null })).toStrictEqual(
      VERIFIED,
    );
  });

  it('refuses an answer without a user', () => {
    expect(toVerifiedUser({ data: { user: null }, error: null })).toStrictEqual({
      status: 'refused',
    });
  });

  // a client error without a code
  it.each([400, 401, 403, 404])('refuses an auth api error with status %p', (status) => {
    expect(authFails(new AuthApiError(SERVER_TEXT, status, undefined))).toStrictEqual({
      status: 'refused',
    });
  });

  // a key without a sub claim, an expired or invalid token
  it('refuses a 403 bad_jwt', () => {
    expect(authFails(BAD_JWT)).toStrictEqual({ status: 'refused' });
  });

  it('refuses a revoked session: an AuthSessionMissingError, status 400, no code', () => {
    expect(SESSION_MISSING).toMatchObject({ name: 'AuthSessionMissingError', status: 400 });
    expect(SESSION_MISSING.code).toBeUndefined();
    expect(authFails(SESSION_MISSING)).toStrictEqual({ status: 'refused' });
  });

  it('reads the 403 user_not_found of a deleted user as gone', () => {
    expect(authFails(USER_NOT_FOUND)).toStrictEqual({ status: 'gone' });
  });

  // the code alone decides, whatever the client status
  it.each([400, 404])('reads user_not_found with status %p as gone', (status) => {
    expect(authFails(new AuthApiError(SERVER_TEXT, status, 'user_not_found'))).toStrictEqual({
      status: 'gone',
    });
  });

  // no answer (status 0), a server or gateway error, a timeout, a rate limit, an answer that is
  // not json (no status)
  it.each([
    ['no answer', new AuthRetryableFetchError('Failed to fetch', 0)],
    ['a 500', new AuthRetryableFetchError(SERVER_TEXT, 500)],
    ['a 503', new AuthRetryableFetchError(SERVER_TEXT, 503)],
    ['a 408', new AuthApiError(SERVER_TEXT, 408, undefined)],
    ['a 429', new AuthApiError(SERVER_TEXT, 429, 'over_request_rate_limit')],
    ['an unreadable answer', new AuthUnknownError(SERVER_TEXT, null)],
  ])('is unavailable on %s', (_case, error) => {
    expect(toVerifiedUser({ data: { user: null }, error })).toStrictEqual({
      status: 'unavailable',
    });
  });
});

describe('toDeletionOutcome', () => {
  it('reads no error as deleted', () => {
    expect(toDeletionOutcome({ error: null })).toBe('deleted');
  });

  it.each([
    ['a 404 user_not_found', new AuthApiError(SERVER_TEXT, 404, 'user_not_found')],
    ['a 404 without a code', new AuthApiError(SERVER_TEXT, 404, undefined)],
    ['user_not_found with another status', new AuthApiError(SERVER_TEXT, 400, 'user_not_found')],
  ])('reads %s as not found', (_case, error) => {
    expect(toDeletionOutcome({ error })).toBe('not-found');
  });

  it.each([
    ['no answer', new AuthRetryableFetchError('Failed to fetch', 0)],
    ['a 403 not_admin', new AuthApiError(SERVER_TEXT, 403, 'not_admin')],
    ['a 500', new AuthRetryableFetchError(SERVER_TEXT, 500)],
    ['an unreadable answer', new AuthUnknownError(SERVER_TEXT, null)],
  ])('reads %s as failed', (_case, error) => {
    expect(toDeletionOutcome({ error })).toBe('failed');
  });
});
