// the library of one signed-in user in supabase (docs/ARCHITECTURE.md §4 "Account store", FR-23),
// over the app's client: rls keeps every request inside the token's own library, and the session
// guard keeps every call inside the library of the user this instance was created for. rows hold
// personal data (notes, titles): never logged, never put in an error or a report tag
import type { SupabaseClient } from '@supabase/supabase-js';

import type { LibraryEntry } from '../../domain/library-entry';
import { compareLibraryEntries, libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import type { ErrorReporter } from '../../errors/error-reporter';
import { LibraryRemoteError } from '../../errors/library-errors';
import { libraryEntrySchema } from '../../schemas/library-entry';
import type { LibraryRepository } from '../library-repository';
import type { Database } from './database.types';
import {
  libraryReportContext,
  toLibraryRemoteError,
  type LibraryFailure,
  type LibraryOperation,
} from './library-error-mapper';
import { LIBRARY_ROW_COLUMNS, parseLibraryRow, toLibraryRowPayload } from './library-row';

/** the rows asked per page of `list()`: the `max_rows` of supabase/config.toml and hosted projects. */
export const LIBRARY_PAGE_SIZE = 1000;

/** the time a request may take before it is aborted (rejects with `network`). */
export const LIBRARY_REQUEST_TIMEOUT_MS = 15_000;

const LIBRARY_TABLE = 'library_entries';
// the columns of library_entries_user_media_key; user_id takes its auth.uid() default on insert
const LIBRARY_CONFLICT_TARGET = 'user_id,id_namespace,media_kind,external_id';
// a request cut by the timeout: whatever answered after the abort, no response came in time
const TIMED_OUT: LibraryFailure = { type: 'response', status: 0, error: null };

export interface SupabaseLibraryRepositoryOptions {
  /** the user id of the session this instance is created for (AuthSession.userId). */
  readonly userId: string;
  /** receives `rejected` and `unknown` failures, and the first unreadable row. */
  readonly reporter: ErrorReporter;
}

/** the part of a postgrest response every call reads. */
interface PostgrestResult {
  readonly error: unknown;
  readonly status: number;
}

const responseFailure = ({ status, error }: PostgrestResult): LibraryFailure => ({
  type: 'response',
  status,
  error,
});

// an array of rows still to parse
const isRowArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

// of the entries of one key, the most recent `updatedAt`, the first read on a tie: a row updated
// on another device between two pages can be read twice
const latestByKey = (entries: readonly LibraryEntry[]): LibraryEntry[] => {
  const byKey = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    const id = libraryEntryId(entry.key);
    const previous = byKey.get(id);
    if (previous === undefined || entry.updatedAt > previous.updatedAt) {
      byKey.set(id, entry);
    }
  }
  return [...byKey.values()];
};

// the LibraryRepository order on normalized timestamps: rows apart by microseconds can tie
const compareListOrder = compareLibraryEntries('updated');

/**
 * the LibraryRepository of the signed-in user `userId` over `client`. before every call it checks
 * that the client's session is still that user's, else it rejects with `signed-out` and sends
 * nothing. failures reject with a LibraryRemoteError, but an entry libraryEntrySchema rejects,
 * which `save` rejects with a RangeError before sending anything.
 */
export const createSupabaseLibraryRepository = (
  client: SupabaseClient<Database>,
  { userId, reporter }: SupabaseLibraryRepositoryOptions,
): LibraryRepository => {
  let invalidRowReported = false;

  // the error of a failure; network and signed-out are expected and never reported, an
  // unreadable row once per instance
  const fail = (operation: LibraryOperation, failure: LibraryFailure): LibraryRemoteError => {
    const error = toLibraryRemoteError(failure);
    const isFirstInvalidRow = error.reason === 'invalid-row' && !invalidRowReported;
    if (error.reason === 'rejected' || error.reason === 'unknown' || isFirstInvalidRow) {
      invalidRowReported ||= isFirstInvalidRow;
      reporter.captureError(error, libraryReportContext(operation, failure));
    }
    return error;
  };

  // whether the client's session is this instance's user; an error reading it counts as no
  // session, which the caller rejects with signed-out
  const hasOwnSession = async (): Promise<boolean> => {
    try {
      const { data, error } = await client.auth.getSession();
      return error === null && data.session?.user.id === userId;
    } catch {
      return false;
    }
  };

  // runs a call after the session guard, which rejects with signed-out and sends nothing; anything
  // thrown that is not already mapped is unknown
  const run = async <T>(operation: LibraryOperation, call: () => Promise<T>): Promise<T> => {
    if (!(await hasOwnSession())) {
      throw fail(operation, { type: 'session' });
    }
    try {
      return await call();
    } catch (error) {
      throw error instanceof LibraryRemoteError
        ? error
        : fail(operation, { type: 'thrown', error });
    }
  };

  // sends one request with a signal aborted after LIBRARY_REQUEST_TIMEOUT_MS (a plain controller
  // and timer: react native polyfills AbortController without AbortSignal.timeout), and rejects
  // its error response. a request cut by the timeout is a network failure, whatever answered
  const send = async <T extends PostgrestResult>(
    operation: LibraryOperation,
    request: (signal: AbortSignal) => PromiseLike<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, LIBRARY_REQUEST_TIMEOUT_MS);
    try {
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

  const parseRow = (operation: LibraryOperation, row: unknown): LibraryEntry => {
    const entry = parseLibraryRow(row);
    if (entry === null) {
      throw fail(operation, { type: 'invalid-row' });
    }
    return entry;
  };

  // every row of the user, page by page: the offset advances by the rows received, so a server
  // whose max_rows is below the page size returns shorter pages that are never taken for the end
  const readAllRows = async (): Promise<unknown[]> => {
    const rows: unknown[] = [];
    for (;;) {
      const offset = rows.length;
      const response = await send('list', (signal) =>
        client
          .from(LIBRARY_TABLE)
          .select(LIBRARY_ROW_COLUMNS, { count: 'exact' })
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .order('id_namespace')
          .order('media_kind')
          .order('external_id')
          .range(offset, offset + LIBRARY_PAGE_SIZE - 1)
          .abortSignal(signal),
      );
      // typed as rows, but a success with an empty body reads as null: a server fault (unknown)
      const page: unknown = response.data;
      if (!isRowArray(page)) {
        throw fail('list', responseFailure(response));
      }
      rows.push(...page);
      if (page.length === 0 || (response.count !== null && rows.length >= response.count)) {
        return rows;
      }
    }
  };

  const list = (): Promise<readonly LibraryEntry[]> =>
    run('list', async () => {
      const entries: LibraryEntry[] = [];
      let hasInvalidRow = false;
      for (const row of await readAllRows()) {
        const entry = parseLibraryRow(row);
        if (entry === null) {
          hasInvalidRow = true;
        } else {
          entries.push(entry);
        }
      }
      if (hasInvalidRow) {
        // left out and reported, never thrown: the row stays on the server for a newer version
        fail('list', { type: 'invalid-row' });
      }
      return latestByKey(entries).sort(compareListOrder);
    });

  const get = (key: MediaKey): Promise<LibraryEntry | null> =>
    run('get', async () => {
      const response = await send('get', (signal) =>
        client
          .from(LIBRARY_TABLE)
          .select(LIBRARY_ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('id_namespace', key.namespace)
          .eq('media_kind', key.kind)
          .eq('external_id', key.externalId)
          .abortSignal(signal)
          .maybeSingle(),
      );
      return response.data === null ? null : parseRow('get', response.data);
    });

  const save = (entry: LibraryEntry): Promise<LibraryEntry> => {
    const parsed = libraryEntrySchema.safeParse(entry);
    if (!parsed.success) {
      // the message holds no value: the ui validates user input first, this is a bug
      return Promise.reject(new RangeError('library entry is outside the database limits'));
    }
    return run('save', async () => {
      const response = await send('save', (signal) =>
        client
          .from(LIBRARY_TABLE)
          .upsert(toLibraryRowPayload(parsed.data), { onConflict: LIBRARY_CONFLICT_TARGET })
          .select(LIBRARY_ROW_COLUMNS)
          .abortSignal(signal)
          .single(),
      );
      // typed as a row, but a success with an empty body reads as null: a server fault (unknown)
      const row: unknown = response.data;
      if (row === null) {
        throw fail('save', responseFailure(response));
      }
      // the write happened even when its row is unreadable; the writer then refetches the entry
      return parseRow('save', row);
    });
  };

  const remove = (key: MediaKey): Promise<void> =>
    run('remove', async () => {
      await send('remove', (signal) =>
        client
          .from(LIBRARY_TABLE)
          .delete()
          .eq('user_id', userId)
          .eq('id_namespace', key.namespace)
          .eq('media_kind', key.kind)
          .eq('external_id', key.externalId)
          .abortSignal(signal),
      );
    });

  return { list, get, save, remove };
};
