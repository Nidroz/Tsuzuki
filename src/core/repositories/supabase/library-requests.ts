// the requests of the account library store (library-repository.ts) and of the guest merge
// (library-merge.ts), for one user over the app's client: the session guard and the timeout around
// every request, the mapping and reporting of failures, and the paged read of the user's rows.
// rows hold personal data (notes, titles): nothing here logs them or puts them in an error or a tag
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ErrorContext, ErrorReporter } from '../../errors/error-reporter';
import { LibraryRemoteError } from '../../errors/library-errors';
import type { Database } from './database.types';
import {
  libraryReportContext,
  toLibraryRemoteError,
  type LibraryFailure,
  type LibraryOperation,
} from './library-error-mapper';

/** the rows asked per page of a paged read: the `max_rows` of supabase/config.toml and hosted projects. */
export const LIBRARY_PAGE_SIZE = 1000;

/**
 * the time a request may take, the session guard's read included, before it is aborted (rejects
 * with `network`).
 */
export const LIBRARY_REQUEST_TIMEOUT_MS = 15_000;

/** the table of the account library. */
export const LIBRARY_TABLE = 'library_entries';

/** the columns of library_entries_user_media_key; user_id takes its auth.uid() default on insert. */
export const LIBRARY_CONFLICT_TARGET = 'user_id,id_namespace,media_kind,external_id';

// a request cut by the timeout: whatever answered after the abort, no response came in time
const TIMED_OUT: LibraryFailure = { type: 'response', status: 0, error: null };

/** the part of a postgrest response every request reads. */
export interface PostgrestResult {
  readonly error: unknown;
  readonly status: number;
}

// what the session guard read: the session of this user, none or another user's, or an error
type SessionState = 'own' | 'other' | 'unreadable';

/** a postgrest response of a page: its rows, unless the server failed, and the exact count. */
export interface PostgrestPage extends PostgrestResult {
  readonly data: unknown;
  readonly count: number | null;
}

/** the query of the rows `from` to `to` (inclusive) of the user, counted, aborted by `signal`. */
export type PageQuery = (
  from: number,
  to: number,
  signal: AbortSignal,
) => PromiseLike<PostgrestPage>;

export interface LibraryRequestsOptions {
  /** the user id of the session the requests are made for (AuthSession.userId). */
  readonly userId: string;
  /**
   * receives `rejected` failures, `unknown` failures once per operation and status per outage,
   * and the first unreadable row.
   */
  readonly reporter: ErrorReporter;
}

// the tag of an unknown failure without a status (no response, an error thrown by the client)
const NO_STATUS = 'none';

/** the failure of a response, for the error mapper. */
export const responseFailure = ({ status, error }: PostgrestResult): LibraryFailure => ({
  type: 'response',
  status,
  error,
});

/** whether a response body is an array of rows still to parse. */
export const isRowArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/**
 * the requests of the user `userId` over `client`. `send` checks before each request, under the
 * request timeout, that the client's session is still that user's, else it rejects with
 * `signed-out` and sends nothing; a session read that fails or does not answer in time rejects
 * with `network`, and nothing is sent either. an `unknown` failure is reported once per operation
 * and status (its report tags) until a call of `run` succeeds: the first of each outage always,
 * never each request of a lasting 5xx.
 */
export const createLibraryRequests = (
  client: SupabaseClient<Database>,
  { userId, reporter }: LibraryRequestsOptions,
) => {
  let invalidRowReported = false;
  // the operation and status of each unknown failure reported since the last call that succeeded
  const outageReported = new Set<string>();

  // whether an unknown failure of this operation and status is the first since the last success
  const isFirstOfOutage = (operation: LibraryOperation, context: ErrorContext): boolean => {
    const id = `${operation}:${context.tags?.status ?? NO_STATUS}`;
    if (outageReported.has(id)) {
      return false;
    }
    outageReported.add(id);
    return true;
  };

  // the error of a failure; network and signed-out are expected and never reported, an
  // unreadable row once per instance, an unknown failure once per operation and status per outage
  const fail = (operation: LibraryOperation, failure: LibraryFailure): LibraryRemoteError => {
    const error = toLibraryRemoteError(failure);
    const context = libraryReportContext(operation, failure);
    const isFirstInvalidRow = error.reason === 'invalid-row' && !invalidRowReported;
    const isReported =
      error.reason === 'rejected' ||
      isFirstInvalidRow ||
      (error.reason === 'unknown' && isFirstOfOutage(operation, context));
    if (isReported) {
      invalidRowReported ||= isFirstInvalidRow;
      reporter.captureError(error, context);
    }
    return error;
  };

  // whose session the client holds: this user's, none or another user's (`other`), or it could not
  // be read (`unreadable`: an error result or a thrown error, such as a token refresh failing
  // offline), which is transient and never read as a sign out (ADR-0017)
  const readSession = async (): Promise<SessionState> => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error !== null) {
        return 'unreadable';
      }
      return data.session?.user.id === userId ? 'own' : 'other';
    } catch {
      return 'unreadable';
    }
  };

  // the session guard's answer, or null when `signal` aborts first: supabase-js reads the session
  // storage (the secure store on mobile) behind a lock, and that read has no timeout of its own
  const guard = (signal: AbortSignal): Promise<SessionState | null> =>
    new Promise((resolve) => {
      signal.addEventListener('abort', () => {
        resolve(null);
      });
      void readSession().then(resolve);
    });

  // runs a call; anything thrown that is not already mapped is unknown. a call that succeeds ends
  // the outage: the next unknown failure is reported again
  const run = async <T>(operation: LibraryOperation, call: () => Promise<T>): Promise<T> => {
    try {
      const value = await call();
      outageReported.clear();
      return value;
    } catch (error) {
      throw error instanceof LibraryRemoteError
        ? error
        : fail(operation, { type: 'thrown', error });
    }
  };

  // sends one request after the session guard, both under one signal aborted after
  // LIBRARY_REQUEST_TIMEOUT_MS (a plain controller and timer: react native polyfills
  // AbortController without AbortSignal.timeout), and rejects its error response. a request cut
  // by the timeout is a network failure, whatever answered
  const send = async <T extends PostgrestResult>(
    operation: LibraryOperation,
    request: (signal: AbortSignal) => PromiseLike<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, LIBRARY_REQUEST_TIMEOUT_MS);
    try {
      const session = await guard(controller.signal);
      if (session === null) {
        throw fail(operation, TIMED_OUT);
      }
      if (session === 'unreadable') {
        throw fail(operation, { type: 'session-read' });
      }
      if (session === 'other') {
        throw fail(operation, { type: 'session' });
      }
      const response = await request(controller.signal);
      if (controller.signal.aborted) {
        throw fail(operation, TIMED_OUT);
      }
      if (response.error !== null) {
        throw fail(operation, responseFailure(response));
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  };

  // every row `page` reads, page by page: the offset advances by the rows received, so a server
  // whose max_rows is below the page size returns shorter pages that are never taken for the end
  const readAllRows = async (operation: LibraryOperation, page: PageQuery): Promise<unknown[]> => {
    const rows: unknown[] = [];
    for (;;) {
      const offset = rows.length;
      const response = await send(operation, (signal) =>
        page(offset, offset + LIBRARY_PAGE_SIZE - 1, signal),
      );
      // typed as rows, but a success with an empty body reads as null: a server fault (unknown)
      const received: unknown = response.data;
      if (!isRowArray(received)) {
        throw fail(operation, responseFailure(response));
      }
      rows.push(...received);
      if (received.length === 0 || (response.count !== null && rows.length >= response.count)) {
        return rows;
      }
    }
  };

  return { client, userId, fail, run, send, readAllRows };
};

/** the requests of one user over one client. */
export type LibraryRequests = ReturnType<typeof createLibraryRequests>;
