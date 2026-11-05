// the two documents of the offline account library (ADR-0017), kept per user id in the app
// StorageAdapter: the device copy of the last server state seen, and the write queue. stored
// content is untrusted and parsed with zod on every read; these helpers are pure, the store reads,
// writes and reports. entries and writes hold personal data: never logged
import { z } from 'zod';

import type { LibraryEntry } from '../../domain/library-entry';
import {
  libraryQueuedWriteKey,
  type LibraryQueuedWrite,
  type LibraryWriteFailureState,
} from '../../domain/library-sync';
import { libraryEntryId } from '../../domain/library-view';
import type { LibraryStorageReason } from '../../errors/library-errors';
import { libraryQueuedWriteSchema } from '../../schemas/library-sync';
import { readGuestLibrary, serializeGuestLibrary, sortLibraryEntries } from './library-store';

/** the storage key prefix of a user's device copy: `account-library-copy.<userId>`. */
export const ACCOUNT_LIBRARY_COPY_KEY_PREFIX = 'account-library-copy.';

/** the storage key prefix of a user's write queue: `account-library-queue.<userId>`. */
export const ACCOUNT_LIBRARY_QUEUE_KEY_PREFIX = 'account-library-queue.';

/** the documents, as named in the `document` tag of a storage report. */
export type AccountLibraryDocument = 'account-copy' | 'account-queue';

/**
 * the queue envelope version this reader understands; a later version must stay readable by it, or
 * use a new key (an older bundle reads an unknown version as empty).
 */
const QUEUE_ENVELOPE_VERSION = 1;

/** the first seq of a queue that never held a write. */
const FIRST_SEQ = 1;

// a user id as supabase issues it: checked before any key is built from it
const userIdSchema = z.uuid();

/** the storage keys of the documents of `userId`; a RangeError without a value for a non uuid. */
export const accountLibraryStorageKeys = (
  userId: string,
): { readonly copy: string; readonly queue: string } => {
  if (!userIdSchema.safeParse(userId).success) {
    throw new RangeError('account library user id is not a uuid');
  }
  return {
    copy: `${ACCOUNT_LIBRARY_COPY_KEY_PREFIX}${userId}`,
    queue: `${ACCOUNT_LIBRARY_QUEUE_KEY_PREFIX}${userId}`,
  };
};

/**
 * a queued write, its position in the queue (a seq never reused for this user), and its failure
 * state (ADR-0017 "Stuck writes"), held only when set: `refused` true, `failures` above 0. a newer
 * write of the key is a new record, without either.
 */
export interface QueuedWriteRecord extends LibraryWriteFailureState {
  readonly seq: number;
  readonly write: LibraryQueuedWrite;
}

/** the write queue: at most one write per key, by ascending seq, and the next seq to issue. */
export interface AccountLibraryQueue {
  readonly nextSeq: number;
  readonly records: readonly QueuedWriteRecord[];
}

/** what a read of a document gave, and the problems met on the way (each once). */
export interface DocumentRead<T> {
  readonly value: T;
  readonly problems: ReadonlySet<LibraryStorageReason>;
}

const seqSchema = z.number().int().min(FIRST_SEQ).max(Number.MAX_SAFE_INTEGER);

// the envelope is checked here, every record on its own below, so one bad record drops alone
const queueEnvelopeSchema = z.object({
  version: z.literal(QUEUE_ENVELOPE_VERSION),
  nextSeq: seqSchema,
  writes: z.array(z.unknown()),
});

// the failure state is optional and stays in the version 1 envelope: an older reader strips it.
// a value that does not parse reads as absent, so it never drops the write it belongs to
const queueRecordSchema = z.object({
  seq: seqSchema,
  write: libraryQueuedWriteSchema,
  refused: z.boolean().optional().catch(undefined),
  failures: z.number().int().min(0).optional().catch(undefined),
});

/** a record of `seq` and `write` with the failure state of `state`, held only when set. */
export const queuedWriteRecord = (
  seq: number,
  write: LibraryQueuedWrite,
  { refused = false, failures = 0 }: LibraryWriteFailureState,
): QueuedWriteRecord => ({
  seq,
  write,
  ...(refused && { refused }),
  ...(failures > 0 && { failures }),
});

const EMPTY_QUEUE: AccountLibraryQueue = { nextSeq: FIRST_SEQ, records: [] };

// invalid json is a problem the caller reports, never thrown
const parseJson = (stored: string): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(stored) };
  } catch {
    return null;
  }
};

const DOCUMENT_PROBLEMS: ReadonlySet<LibraryStorageReason> = new Set([
  'invalid-json',
  'invalid-envelope',
]);

/**
 * reads the device copy (`undefined` when nothing is stored): its entries in the list order, or
 * null when there is no copy. the copy uses the guest store's envelope and rules (an invalid entry
 * dropped; of two entries of one key, the most recent `updatedAt` kept). a document that is not
 * json or not a version 1 envelope reads as no copy, never as an empty one: an empty copy would
 * answer `null` offline for entries the account holds.
 */
export const readAccountCopy = (
  stored: string | undefined,
): DocumentRead<readonly LibraryEntry[] | null> => {
  if (stored === undefined) {
    return { value: null, problems: new Set() };
  }
  const { entries, problems } = readGuestLibrary(stored);
  const isDamagedDocument = [...problems].some((reason) => DOCUMENT_PROBLEMS.has(reason));
  return { value: isDamagedDocument ? null : entries, problems };
};

/** the stored copy of `entries`: the version 1 envelope in the list order, as json. */
export const serializeAccountCopy = (entries: readonly LibraryEntry[]): string =>
  serializeGuestLibrary(sortLibraryEntries(entries));

/**
 * reads the write queue (`undefined` when nothing is stored), its records by ascending seq. invalid
 * json or an invalid envelope reads as an empty queue; a record whose seq or write fails its
 * schema is dropped, a failure state that does not parse reads as absent; of two records of one
 * key, the higher seq is kept. `nextSeq` is above every seq read.
 */
export const readAccountQueue = (stored: string | undefined): DocumentRead<AccountLibraryQueue> => {
  if (stored === undefined) {
    return { value: EMPTY_QUEUE, problems: new Set() };
  }
  const json = parseJson(stored);
  if (json === null) {
    return { value: EMPTY_QUEUE, problems: new Set(['invalid-json']) };
  }
  const envelope = queueEnvelopeSchema.safeParse(json.value);
  if (!envelope.success) {
    return { value: EMPTY_QUEUE, problems: new Set(['invalid-envelope']) };
  }
  const problems = new Set<LibraryStorageReason>();
  const byKey = new Map<string, QueuedWriteRecord>();
  for (const raw of envelope.data.writes) {
    const parsed = queueRecordSchema.safeParse(raw);
    if (!parsed.success) {
      problems.add('invalid-entries');
      continue;
    }
    const { seq, write, refused, failures } = parsed.data;
    const id = libraryEntryId(libraryQueuedWriteKey(write));
    const previous = byKey.get(id);
    if (previous !== undefined) {
      problems.add('duplicate-keys');
    }
    if (previous === undefined || seq > previous.seq) {
      byKey.set(
        id,
        queuedWriteRecord(seq, write, { refused: refused ?? false, failures: failures ?? 0 }),
      );
    }
  }
  const records = [...byKey.values()].sort((a, b) => a.seq - b.seq);
  const highestSeq = records.at(-1)?.seq ?? 0;
  return {
    value: { nextSeq: Math.max(envelope.data.nextSeq, highestSeq + 1), records },
    problems,
  };
};

/** the stored queue: the version 1 envelope, as json, a failure state only when set. */
export const serializeAccountQueue = ({ nextSeq, records }: AccountLibraryQueue): string =>
  JSON.stringify({
    version: QUEUE_ENVELOPE_VERSION,
    nextSeq,
    writes: records.map(({ seq, write, ...state }) => queuedWriteRecord(seq, write, state)),
  });
