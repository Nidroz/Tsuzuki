// the account deletion of the signed-in user (FR-24, ADR-0018): one POST to the delete-account
// edge function, which verifies the session's access token with the auth server and deletes that
// token's user. no body and no user id are sent: supabase-js adds the access token. a failure
// becomes an AccountDeletionError; only `unknown` is reported, with the status and the function's
// fixed error code at most: never a server text, a token or an id
import {
  FunctionsFetchError,
  FunctionsHttpError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { z } from 'zod';

import { AccountDeletionError } from '../../errors/account-deletion-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import { AUTH_REPORT_SOURCE, type AuthOperation } from './auth-error-mapper';
import type { Database } from './database.types';

/** the edge function deleting the user of the request's token (supabase/functions/delete-account). */
export const ACCOUNT_DELETION_FUNCTION = 'delete-account';

/**
 * the time the request may take until its answer arrives, under SUPABASE_FETCH_TIMEOUT_MS. the
 * session read before it and the read of an error body after it are bounded by it too, so a
 * stalled secure store or body never keeps the deletion pending.
 */
export const ACCOUNT_DELETION_TIMEOUT_MS = 20_000;

const OPERATION: AuthOperation = 'delete-account';

const HTTP_UNAUTHORIZED = 401;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
// no answer of the function in time, a rate limit, or the gateway could not reach it: the account
// may or may not be deleted
const NO_ANSWER_STATUSES: ReadonlySet<number> = new Set([
  HTTP_REQUEST_TIMEOUT,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
]);

/**
 * the fixed error codes of the function's bodies (RESPONSES in
 * supabase/functions/delete-account/handler.ts, kept in sync by its client-error-codes test): a
 * body holding anything else is never reported.
 */
export const FUNCTION_ERROR_CODES = [
  'method-not-allowed',
  'server-misconfigured',
  'unauthorized',
  'unavailable',
  'deletion-failed',
] as const;

const deletedAnswerSchema = z.object({ deleted: z.literal(true) });
const errorBodySchema = z.object({ error: z.enum(FUNCTION_ERROR_CODES) });

const TIMED_OUT = Symbol('timed out');

// the value of `promise`, or TIMED_OUT when `timeoutMs` passes first; the timer is cleared either way
const within = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

// whether the device holds a session: an error result, a thrown error or no answer in time is
// `unreadable` (a token refresh failing offline, a stalled secure store)
const readSession = async (
  client: SupabaseClient<Database>,
): Promise<'present' | 'absent' | 'unreadable'> => {
  try {
    const result = await within(client.auth.getSession(), ACCOUNT_DELETION_TIMEOUT_MS);
    if (result === TIMED_OUT || result.error !== null) {
      return 'unreadable';
    }
    return result.data.session === null ? 'absent' : 'present';
  } catch {
    return 'unreadable';
  }
};

// the function's fixed error code in the body of `response`, read defensively: a body that does not
// arrive in time, is not json or holds anything but a fixed code gives none
const errorCodeOf = async (response: Response): Promise<string | undefined> => {
  try {
    const text = await within(response.text(), ACCOUNT_DELETION_TIMEOUT_MS);
    if (text === TIMED_OUT) {
      return undefined;
    }
    const body: unknown = JSON.parse(text);
    const parsed = errorBodySchema.safeParse(body);
    return parsed.success ? parsed.data.error : undefined;
  } catch {
    return undefined;
  }
};

/**
 * the deleteAccount of the AuthRepository over `client` (its contract is in ../auth-repository.ts):
 * reports `unknown` failures to `reporter` as `{ source: 'auth', tags: { operation:
 * 'delete-account', status?, code? } }`.
 */
export const requestAccountDeletion = async (
  client: SupabaseClient<Database>,
  reporter: ErrorReporter,
): Promise<void> => {
  const session = await readSession(client);
  if (session !== 'present') {
    throw new AccountDeletionError(session === 'absent' ? 'session-expired' : 'network');
  }

  // an unknown failure, reported with the status of `response` and, when `withCode`, the fixed
  // code of its body
  const unknown = async (response?: Response, withCode = false): Promise<AccountDeletionError> => {
    const error = new AccountDeletionError('unknown');
    const code = withCode && response !== undefined ? await errorCodeOf(response) : undefined;
    reporter.captureError(error, {
      source: AUTH_REPORT_SOURCE,
      tags: {
        operation: OPERATION,
        ...(response !== undefined && { status: String(response.status) }),
        ...(code !== undefined && { code }),
      },
    });
    return error;
  };

  let result: Awaited<ReturnType<SupabaseClient<Database>['functions']['invoke']>>;
  try {
    result = await client.functions.invoke<unknown>(ACCOUNT_DELETION_FUNCTION, {
      method: 'POST',
      timeout: ACCOUNT_DELETION_TIMEOUT_MS,
    });
  } catch {
    // functions-js returns its failures: a throw is a bug of the client
    throw await unknown();
  }
  const { response } = result;
  const error: unknown = result.error;
  if (error === null) {
    if (deletedAnswerSchema.safeParse(result.data).success) {
      return;
    }
    throw await unknown(response);
  }
  // no answer: a fetch error, or the timeout aborting the request
  if (error instanceof FunctionsFetchError) {
    throw new AccountDeletionError('network');
  }
  if (error instanceof FunctionsHttpError && response !== undefined) {
    if (response.status === HTTP_UNAUTHORIZED) {
      throw new AccountDeletionError('session-expired');
    }
    if (NO_ANSWER_STATUSES.has(response.status)) {
      throw new AccountDeletionError('network');
    }
    throw await unknown(response, true);
  }
  // a relay error, or a success whose body could not be read
  throw await unknown(response);
};
