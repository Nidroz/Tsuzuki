// the library of one signed-in user in supabase (docs/ARCHITECTURE.md §4 "Account store", FR-23),
// over the app's client: rls keeps every request inside the token's own library, and the session
// guard keeps every request inside the library of the user this instance was created for. rows
// hold personal data (notes, titles): never logged, never put in an error or a report tag
import type { SupabaseClient } from '@supabase/supabase-js';

import type { LibraryEntry } from '../../domain/library-entry';
import { compareLibraryEntries, libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import type { ErrorReporter } from '../../errors/error-reporter';
import { libraryEntrySchema } from '../../schemas/library-entry';
import type { AccountLibraryRepository } from '../library-repository';
import type { Database } from './database.types';
import { mergeGuestEntries } from './library-merge';
import {
  LIBRARY_CONFLICT_TARGET,
  LIBRARY_TABLE,
  createLibraryRequests,
  responseFailure,
} from './library-requests';
import { LIBRARY_ROW_COLUMNS, parseLibraryRow, toLibraryRowPayload } from './library-row';

export interface SupabaseLibraryRepositoryOptions {
  /** the user id of the session this instance is created for (AuthSession.userId). */
  readonly userId: string;
  /** receives `rejected` and `unknown` failures, and the first unreadable row. */
  readonly reporter: ErrorReporter;
}

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
 * the AccountLibraryRepository of the signed-in user `userId` over `client`. before every request
 * it checks that the client's session is still that user's, else it rejects with `signed-out` and
 * sends nothing (library-requests.ts). failures reject with a LibraryRemoteError, but an entry
 * libraryEntrySchema rejects, which `save` and `mergeGuestEntries` reject with a RangeError before
 * sending anything.
 */
export const createSupabaseLibraryRepository = (
  client: SupabaseClient<Database>,
  { userId, reporter }: SupabaseLibraryRepositoryOptions,
): AccountLibraryRepository => {
  const requests = createLibraryRequests(client, { userId, reporter });
  const { fail, run, send, readAllRows } = requests;

  const parseRow = (operation: 'get' | 'save', row: unknown): LibraryEntry => {
    const entry = parseLibraryRow(row);
    if (entry === null) {
      throw fail(operation, { type: 'invalid-row' });
    }
    return entry;
  };

  const list = (): Promise<readonly LibraryEntry[]> =>
    run('list', async () => {
      const rows = await readAllRows('list', (from, to, signal) =>
        client
          .from(LIBRARY_TABLE)
          .select(LIBRARY_ROW_COLUMNS, { count: 'exact' })
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .order('id_namespace')
          .order('media_kind')
          .order('external_id')
          .range(from, to)
          .abortSignal(signal),
      );
      const entries: LibraryEntry[] = [];
      let hasInvalidRow = false;
      for (const row of rows) {
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

  return {
    list,
    get,
    save,
    remove,
    mergeGuestEntries: (entries) => mergeGuestEntries(requests, entries),
  };
};
