// failed calls of the account library store to LibraryRemoteError reasons and report contexts
// (docs/ARCHITECTURE.md §4 "Account store"). the postgrest error never leaves this module: its
// message, details and hint are server text, which can quote the row (a 23505 detail holds the
// user id and the media key). only the code, when it is an identifier, and the status are kept
import { z } from 'zod';

import type { ErrorContext } from '../../errors/error-reporter';
import { LibraryRemoteError, type LibraryRemoteReason } from '../../errors/library-errors';

/** the repository calls, as named in reports. */
export type LibraryOperation = 'list' | 'get' | 'save' | 'remove';

/** the `source` of every account library report. */
export const LIBRARY_REPORT_SOURCE = 'library-remote';

/**
 * a failed call before it is mapped: a postgrest response (`status` 0 when no response came: a
 * lost connection, the timeout; `error` its postgrest error, null for a success without its row),
 * the session guard, a row parseLibraryRow rejects, or an error thrown by the client.
 */
export type LibraryFailure =
  | { readonly type: 'response'; readonly status: number; readonly error: unknown }
  | { readonly type: 'session' }
  | { readonly type: 'invalid-row' }
  | { readonly type: 'thrown'; readonly error: unknown };

const NO_RESPONSE = 0;
const HTTP_UNAUTHORIZED = 401;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_CLIENT_ERROR_MAX = 499;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
// the api or its proxy is unreachable
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
]);

// a sqlstate such as 23514, or a postgrest code such as PGRST204: anything else could be text
const REPORTABLE_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

const errorCodeSchema = z.object({ code: z.string().regex(REPORTABLE_CODE) });

const responseReason = (status: number): LibraryRemoteReason => {
  if (status === NO_RESPONSE || GATEWAY_STATUSES.has(status)) {
    return 'network';
  }
  if (status === HTTP_UNAUTHORIZED) {
    return 'signed-out';
  }
  return status >= HTTP_CLIENT_ERROR_MIN && status <= HTTP_CLIENT_ERROR_MAX
    ? 'rejected'
    : 'unknown';
};

/** the reason of a failed call. */
export const libraryRemoteReason = (failure: LibraryFailure): LibraryRemoteReason => {
  switch (failure.type) {
    case 'response':
      return responseReason(failure.status);
    case 'session':
      return 'signed-out';
    case 'invalid-row':
      return 'invalid-row';
    case 'thrown':
      return 'unknown';
  }
};

/** the LibraryRemoteError of a failed call: the reason only, no server text, no cause. */
export const toLibraryRemoteError = (failure: LibraryFailure): LibraryRemoteError =>
  new LibraryRemoteError(libraryRemoteReason(failure));

/**
 * the report context of a failed call: the operation, the postgres or postgrest code when it is an
 * identifier, and the http status when a response came. never a key, a value or server text.
 */
export const libraryReportContext = (
  operation: LibraryOperation,
  failure: LibraryFailure,
): ErrorContext => {
  if (failure.type !== 'response' || failure.status === NO_RESPONSE) {
    return { source: LIBRARY_REPORT_SOURCE, tags: { operation } };
  }
  const code = errorCodeSchema.safeParse(failure.error);
  const status = String(failure.status);
  return {
    source: LIBRARY_REPORT_SOURCE,
    tags: code.success ? { operation, code: code.data.code, status } : { operation, status },
  };
};
