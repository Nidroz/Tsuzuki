// the replay of the account library writes the server has not confirmed (A-05, ADR-0017), through
// the database function replay_library_writes: one call per batch, applied whole or not at all,
// the user taken from the token only and the store's user sent as a guard. a save is applied as a
// guest merge entry, a removal deletes the stored entry only when it is strictly older than the
// time of the removal, both capped at the server's now() (BR-08). writes hold personal data
// (notes, titles): never logged, never put in an error or a report tag
import { z } from 'zod';

import {
  LIBRARY_REPLAY_BATCH_SIZE,
  LIBRARY_REPLAY_OUTCOMES,
  libraryQueuedWriteKey,
  type LibraryQueuedWrite,
  type LibraryReplayOutcome,
} from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import { LibraryRemoteError } from '../../errors/library-errors';
import { mediaKeySchema } from '../../schemas/library-entry';
import { libraryQueuedWriteSchema } from '../../schemas/library-sync';
import { responseFailure, type LibraryRequests } from './library-requests';
import { toLibraryRowPayload, type LibraryRowPayload } from './library-row';

// the database function of the replay
const REPLAY_FUNCTION = 'replay_library_writes';

// the sqlstate the function raises when the token holds no user or not the expected one
const INSUFFICIENT_PRIVILEGE = '42501';

const { namespace, kind, externalId } = mediaKeySchema.shape;

// the error of a call the function refused for its caller: the token is no longer the store's
// user (a session switch, or no user), never a refused write
const refusedCallerSchema = z.object({ code: z.literal(INSUFFICIENT_PRIVILEGE) });

// the answer of a call: one row per write, its key, the caller's user id and its outcome
const replayAnswerSchema = z.array(
  z.object({
    id_namespace: namespace,
    media_kind: kind,
    external_id: externalId,
    user_id: z.string(),
    outcome: z.enum(LIBRARY_REPLAY_OUTCOMES),
  }),
);

// the media key columns of a write (a type, not an interface: it must be assignable to Json)
type ReplayKeyPayload = Pick<LibraryRowPayload, 'id_namespace' | 'media_kind' | 'external_id'>;

// a write as the replay function takes it: a save holds every writable column and the time of its
// change, a removal its key and the time of the removal; never user_id, id or created_at
type ReplayPayload =
  | (LibraryRowPayload & { readonly op: 'save'; readonly updated_at: string })
  | (ReplayKeyPayload & { readonly op: 'remove'; readonly updated_at: string });

const toReplayPayload = (write: LibraryQueuedWrite): ReplayPayload =>
  write.type === 'save'
    ? { op: 'save', ...toLibraryRowPayload(write.entry), updated_at: write.entry.updatedAt }
    : {
        op: 'remove',
        id_namespace: write.key.namespace,
        media_kind: write.key.kind,
        external_id: write.key.externalId,
        updated_at: write.removedAt,
      };

// the writes parsed (times normalized), at most LIBRARY_REPLAY_BATCH_SIZE, each key once; else a
// RangeError whose message holds no value
const parseQueuedWrites = (writes: readonly LibraryQueuedWrite[]): LibraryQueuedWrite[] => {
  // the batch size must stay equal to the max_writes of replay_library_writes
  // (supabase/migrations/*_replay_library_writes.sql), which refuses a longer list
  if (writes.length > LIBRARY_REPLAY_BATCH_SIZE) {
    throw new RangeError('library replay holds too many writes');
  }
  const ids = new Set<string>();
  return writes.map((write) => {
    const parsed = libraryQueuedWriteSchema.safeParse(write);
    if (!parsed.success) {
      throw new RangeError('queued library write is outside the database limits');
    }
    const id = libraryEntryId(libraryQueuedWriteKey(parsed.data));
    if (ids.has(id)) {
      throw new RangeError('queued library writes hold one media twice');
    }
    ids.add(id);
    return parsed.data;
  });
};

/**
 * the RemoteAccountLibraryRepository `replayWrites` over `requests` (its contract is in
 * ../library-repository.ts): validates every write first (a RangeError, nothing sent), resolves an
 * empty list without a request, then sends one call behind the session guard and the timeout,
 * with the store's user id as the function's guard. the answer confirms the writes only when it
 * holds each key exactly once, as rows of the store's user: a row of another user, or the
 * function refusing its caller (42501: the token changed between the session guard and the
 * request, or holds no user), rejects with `signed-out`, never reported, so the device queue is
 * kept and no write of it is taken for refused (ADR-0017);
 * an answer that does not parse or does not match the writes is a server fault (`unknown`,
 * reported). resolves with the outcomes in input order, whatever the order of the answer.
 */
export const replayWrites = async (
  requests: LibraryRequests,
  writes: readonly LibraryQueuedWrite[],
): Promise<readonly LibraryReplayOutcome[]> => {
  const queued = parseQueuedWrites(writes);
  if (queued.length === 0) {
    return [];
  }
  const { client, userId, run, send, fail } = requests;
  return run('replay', async () => {
    const payload = queued.map(toReplayPayload);
    const response = await send('replay', async (signal) => {
      const result = await client
        .rpc(REPLAY_FUNCTION, { expected_user_id: userId, writes: payload })
        .abortSignal(signal);
      // thrown before send maps the error response: run passes a LibraryRemoteError on, unreported
      if (refusedCallerSchema.safeParse(result.error).success) {
        throw new LibraryRemoteError('signed-out');
      }
      return result;
    });
    const answer = replayAnswerSchema.safeParse(response.data);
    if (!answer.success) {
      throw fail('replay', responseFailure(response));
    }
    if (answer.data.some((row) => row.user_id !== userId)) {
      throw fail('replay', { type: 'session' });
    }
    const outcomes = new Map<string, LibraryReplayOutcome>();
    for (const row of answer.data) {
      outcomes.set(
        libraryEntryId({
          namespace: row.id_namespace,
          kind: row.media_kind,
          externalId: row.external_id,
        }),
        row.outcome,
      );
    }
    // as many rows as writes, no key twice, and each write's key answered: each key exactly once
    if (answer.data.length !== queued.length || outcomes.size !== queued.length) {
      throw fail('replay', responseFailure(response));
    }
    return queued.map((write) => {
      const outcome = outcomes.get(libraryEntryId(libraryQueuedWriteKey(write)));
      if (outcome === undefined) {
        throw fail('replay', responseFailure(response));
      }
      return outcome;
    });
  });
};
