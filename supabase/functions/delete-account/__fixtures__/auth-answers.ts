// the auth answers shared by the delete-account handler tests: the verified user and the auth
// errors of auth-js 2.117.3 (the version of the deno entry), as auth.getUser(token) and
// auth.admin.deleteUser(userId) return them; the server message is free text
import { AuthApiError, AuthSessionMissingError } from '@supabase/supabase-js';

import { toVerifiedUser, type VerifiedUser } from '../handler';

export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const VERIFIED: VerifiedUser = { status: 'verified', userId: USER_ID };

export const SERVER_TEXT = 'server text';
// a signature-valid token whose user no longer exists: 403 user_not_found
export const USER_NOT_FOUND = new AuthApiError(SERVER_TEXT, 403, 'user_not_found');
// a revoked session: auth-js maps the 403 session_not_found to this error, status 400, no code
export const SESSION_MISSING = new AuthSessionMissingError();
// an expired or invalid token
export const BAD_JWT = new AuthApiError(SERVER_TEXT, 403, 'bad_jwt');
// the verification of an auth error, as the deno entry wires it
export const authFails = (error: AuthApiError | AuthSessionMissingError) =>
  toVerifiedUser({ data: { user: null }, error });
