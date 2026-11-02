// the merge of guest entries into the account store (BR-08, FR-22, ADR-0016 "Account side"),
// through the database function merge_guest_library_entries: one call per batch, written whole or
// not at all, the user taken from the token only. each entry keeps its own `updatedAt`, capped at
// the server's now(), and replaces the account copy only when strictly newer; an account copy as
// recent or newer is kept. the database compares, so an account entry another device made newer
// meanwhile is never overwritten. entries hold personal data (notes, titles): never logged, never
// put in an error or a report tag
import { z } from 'zod';

import type { LibraryEntry } from '../../domain/library-entry';
import { libraryEntryId } from '../../domain/library-view';
import { libraryEntrySchema, mediaKeySchema } from '../../schemas/library-entry';
import { responseFailure, type LibraryRequests } from './library-requests';
import { toLibraryRowPayload, type LibraryRowPayload } from './library-row';

/**
 * the guest entries sent per call. must not exceed the `max_entries` of
 * merge_guest_library_entries (supabase/migrations/*_guest_merge_client_time.sql), which rejects
 * a larger batch.
 */
export const GUEST_MERGE_BATCH_SIZE = 100;

// the database function of the merge
const GUEST_MERGE_FUNCTION = 'merge_guest_library_entries';

// what the function answers for an entry: written (inserted or replacing the account copy), or the
// account copy kept, as recent or newer
const GUEST_MERGE_OUTCOMES = ['written', 'kept'] as const;

const { namespace, kind, externalId } = mediaKeySchema.shape;

// the answer of a call: one row per entry, its key, the caller's user id and its outcome
const mergeAnswerSchema = z.array(
  z.object({
    id_namespace: namespace,
    media_kind: kind,
    external_id: externalId,
    user_id: z.string(),
    outcome: z.enum(GUEST_MERGE_OUTCOMES),
  }),
);

// an entry as the merge function takes it: every writable column and its own modification time,
// never user_id, id or created_at
type GuestMergePayload = LibraryRowPayload & { readonly updated_at: string };

const toGuestMergePayload = (entry: LibraryEntry): GuestMergePayload => ({
  ...toLibraryRowPayload(entry),
  updated_at: entry.updatedAt,
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

// whether the answered keys are those of the batch, each exactly once
const answersEachEntryOnce = (batch: readonly LibraryEntry[], answered: readonly string[]) => {
  const asked = new Set(batch.map((entry) => libraryEntryId(entry.key)));
  return (
    answered.length === asked.size &&
    new Set(answered).size === answered.length &&
    answered.every((id) => asked.has(id))
  );
};

// merges one batch in one call, confirmed only by an answer holding each of its entries once. an
// answer row of another user (the token changed between the session guard and the request, the
// A-03 residual window) rejects with signed-out; an answer that does not parse or does not match
// the batch is a server fault (unknown)
const mergeBatch = async (
  requests: LibraryRequests,
  batch: readonly LibraryEntry[],
): Promise<void> => {
  const { client, userId, send, fail } = requests;
  const entries = batch.map(toGuestMergePayload);
  const response = await send('merge', (signal) =>
    client.rpc(GUEST_MERGE_FUNCTION, { entries }).abortSignal(signal),
  );
  const answer = mergeAnswerSchema.safeParse(response.data);
  if (!answer.success) {
    throw fail('merge', responseFailure(response));
  }
  if (answer.data.some((row) => row.user_id !== userId)) {
    throw fail('merge', { type: 'session' });
  }
  const answered = answer.data.map((row) =>
    libraryEntryId({
      namespace: row.id_namespace,
      kind: row.media_kind,
      externalId: row.external_id,
    }),
  );
  if (!answersEachEntryOnce(batch, answered)) {
    throw fail('merge', responseFailure(response));
  }
};

/**
 * the AccountLibraryRepository `mergeGuestEntries` over `requests` (its contract is in
 * ../library-repository.ts): validates every entry first (a RangeError, nothing sent), resolves an
 * empty list without a request, then merges batches of GUEST_MERGE_BATCH_SIZE one after the
 * other, each call behind the session guard and the timeout. a failed batch stops the merge; the
 * batches before it stay written.
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
    for (let start = 0; start < guestEntries.length; start += GUEST_MERGE_BATCH_SIZE) {
      await mergeBatch(requests, guestEntries.slice(start, start + GUEST_MERGE_BATCH_SIZE));
    }
  });
};
