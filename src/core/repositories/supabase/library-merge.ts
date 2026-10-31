// the merge of guest entries into the account store (BR-08, FR-22, ADR-0016 "Account side"), with
// conditional writes under rls: an insert never overwrites (on conflict do nothing) and an update
// holds the comparison in its filter, so the database applies the newest-wins rule to the row as
// it is at the write, and an account entry another device made newer meanwhile is never
// overwritten: its guest entry is classified again in the next round. entries hold personal data
// (notes, titles): never logged, never put in an error or a report tag
import { z } from 'zod';

import { guestMergeDecision } from '../../domain/guest-merge';
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaIdNamespace, MediaKind } from '../../domain/media';
import { libraryEntrySchema, mediaKeySchema } from '../../schemas/library-entry';
import { timestampSchema } from '../../schemas/timestamp';
import {
  LIBRARY_CONFLICT_TARGET,
  LIBRARY_TABLE,
  isRowArray,
  responseFailure,
  type LibraryRequests,
  type PostgrestPage,
} from './library-requests';
import { toLibraryRowPayload, toLibraryRowValues } from './library-row';

/**
 * the rounds of a merge at most. each reads the account again and classifies the entries a
 * concurrent write from another device left unresolved in the previous one.
 */
export const GUEST_MERGE_MAX_ROUNDS = 3;

/** the guest entries sent per insert request. */
export const GUEST_MERGE_INSERT_BATCH_SIZE = 100;

// the key and the time of each row of the user: all the classification needs
const ACCOUNT_KEY_COLUMNS = 'id_namespace, media_kind, external_id, updated_at';
// the key and the owner of a written row: a row of another user is never confirmed
const WRITTEN_ROW_COLUMNS = 'id_namespace, media_kind, external_id, user_id';

const { namespace, kind, externalId } = mediaKeySchema.shape;

const accountKeyRowSchema = z.object({
  id_namespace: namespace,
  media_kind: kind,
  external_id: externalId,
  updated_at: timestampSchema,
});

const writtenRowSchema = z.object({
  id_namespace: namespace,
  media_kind: kind,
  external_id: externalId,
  user_id: z.string(),
});

interface KeyColumns {
  readonly id_namespace: MediaIdNamespace;
  readonly media_kind: MediaKind;
  readonly external_id: number;
}

const rowKeyId = (row: KeyColumns): string =>
  libraryEntryId({
    namespace: row.id_namespace,
    kind: row.media_kind,
    externalId: row.external_id,
  });

// the entries parsed with libraryEntrySchema (timestamps normalized), each key once; else a
// RangeError whose message holds no value
const parseGuestEntries = (entries: readonly LibraryEntry[]): LibraryEntry[] => {
  const ids = new Set<string>();
  return entries.map((entry) => {
    const parsed = libraryEntrySchema.safeParse(entry);
    if (!parsed.success) {
      throw new RangeError('guest library entry is outside the database limits');
    }
    const id = libraryEntryId(parsed.data.key);
    if (ids.has(id)) {
      throw new RangeError('guest library entries hold one media twice');
    }
    ids.add(id);
    return parsed.data;
  });
};

// the `updated_at` of each key of the account, the latest of a key read twice (a row updated on
// another device between two pages). a row that does not parse is left out: its guest entry is
// then sent as an insert, which never overwrites, so it stays unresolved
const readAccountTimes = async ({
  client,
  userId,
  readAllRows,
}: LibraryRequests): Promise<Map<string, string>> => {
  const rows = await readAllRows('merge', (from, to, signal) =>
    client
      .from(LIBRARY_TABLE)
      .select(ACCOUNT_KEY_COLUMNS, { count: 'exact' })
      .eq('user_id', userId)
      .order('id_namespace')
      .order('media_kind')
      .order('external_id')
      .range(from, to)
      .abortSignal(signal),
  );
  const times = new Map<string, string>();
  for (const row of rows) {
    const parsed = accountKeyRowSchema.safeParse(row);
    if (parsed.success) {
      const id = rowKeyId(parsed.data);
      const previous = times.get(id);
      if (previous === undefined || parsed.data.updated_at > previous) {
        times.set(id, parsed.data.updated_at);
      }
    }
  }
  return times;
};

// the keys of the rows a write returned. a row of another user (the token changed between the
// session guard and the request, the A-03 residual window) stops the merge with signed-out and
// confirms nothing; a body that is not rows of the asked columns is a server fault (unknown)
const writtenIds = ({ userId, fail }: LibraryRequests, response: PostgrestPage): Set<string> => {
  const rows: unknown = response.data;
  if (!isRowArray(rows)) {
    throw fail('merge', responseFailure(response));
  }
  const ids = new Set<string>();
  for (const row of rows) {
    const parsed = writtenRowSchema.safeParse(row);
    if (!parsed.success) {
      throw fail('merge', responseFailure(response));
    }
    if (parsed.data.user_id !== userId) {
      throw fail('merge', { type: 'session' });
    }
    ids.add(rowKeyId(parsed.data));
  }
  return ids;
};

// inserts the entries without a row, never overwriting one (on conflict do nothing): the ids of
// the entries whose row was inserted
const insertBatch = async (
  requests: LibraryRequests,
  batch: readonly LibraryEntry[],
): Promise<string[]> => {
  const { client, send } = requests;
  const response = await send('merge', (signal) =>
    client
      .from(LIBRARY_TABLE)
      .upsert(
        batch.map((entry) => toLibraryRowPayload(entry)),
        { onConflict: LIBRARY_CONFLICT_TARGET, ignoreDuplicates: true },
      )
      .select(WRITTEN_ROW_COLUMNS)
      .abortSignal(signal),
  );
  const written = writtenIds(requests, response);
  return batch.map((entry) => libraryEntryId(entry.key)).filter((id) => written.has(id));
};

// replaces the values of the entry's row only while that row is older than the entry: the filter
// holds the comparison, so a row another device made newer meanwhile matches nothing. whether the
// row was updated
const replaceValues = async (requests: LibraryRequests, entry: LibraryEntry): Promise<boolean> => {
  const { client, userId, send } = requests;
  const response = await send('merge', (signal) =>
    client
      .from(LIBRARY_TABLE)
      .update(toLibraryRowValues(entry))
      .eq('user_id', userId)
      .eq('id_namespace', entry.key.namespace)
      .eq('media_kind', entry.key.kind)
      .eq('external_id', entry.key.externalId)
      .lt('updated_at', entry.updatedAt)
      .select(WRITTEN_ROW_COLUMNS)
      .abortSignal(signal),
  );
  return writtenIds(requests, response).has(libraryEntryId(entry.key));
};

// one round: reads the account, keeps what is newer or as recent there, inserts in batches, then
// replaces one entry at a time. the entries no write confirmed, for the next round
const mergeRound = async (
  requests: LibraryRequests,
  unresolved: readonly LibraryEntry[],
): Promise<LibraryEntry[]> => {
  const accountTimes = await readAccountTimes(requests);
  const inserts: LibraryEntry[] = [];
  const replaces: LibraryEntry[] = [];
  for (const entry of unresolved) {
    const accountUpdatedAt = accountTimes.get(libraryEntryId(entry.key)) ?? null;
    switch (guestMergeDecision(entry.updatedAt, accountUpdatedAt)) {
      case 'insert':
        inserts.push(entry);
        break;
      case 'replace':
        replaces.push(entry);
        break;
      case 'keep':
        break;
    }
  }
  const written = new Set<string>();
  for (let start = 0; start < inserts.length; start += GUEST_MERGE_INSERT_BATCH_SIZE) {
    const batch = inserts.slice(start, start + GUEST_MERGE_INSERT_BATCH_SIZE);
    for (const id of await insertBatch(requests, batch)) {
      written.add(id);
    }
  }
  for (const entry of replaces) {
    if (await replaceValues(requests, entry)) {
      written.add(libraryEntryId(entry.key));
    }
  }
  return [...inserts, ...replaces].filter((entry) => !written.has(libraryEntryId(entry.key)));
};

/**
 * the AccountLibraryRepository `mergeGuestEntries` over `requests` (its contract is in
 * ../library-repository.ts): validates every entry first (a RangeError, nothing sent), resolves an
 * empty list without a request, then runs up to GUEST_MERGE_MAX_ROUNDS rounds, each request behind
 * the session guard and the timeout. entries still unresolved after the last round reject with
 * `unknown`, reported once.
 */
export const mergeGuestEntries = async (
  requests: LibraryRequests,
  entries: readonly LibraryEntry[],
): Promise<void> => {
  const guestEntries = parseGuestEntries(entries);
  if (guestEntries.length === 0) {
    return;
  }
  await requests.run('merge', async () => {
    let unresolved: readonly LibraryEntry[] = guestEntries;
    for (let round = 0; round < GUEST_MERGE_MAX_ROUNDS && unresolved.length > 0; round += 1) {
      unresolved = await mergeRound(requests, unresolved);
    }
    if (unresolved.length > 0) {
      throw requests.fail('merge', { type: 'unresolved' });
    }
  });
};
