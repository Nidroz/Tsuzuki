// the replay run of the offline account library (ADR-0017): the queued writes of one user sent
// with the time of their change, in batches taken from the queue as it stands, one run per user at
// a time. a write leaves the queue only once the server confirmed it; a write the database refused
// alone, or one that keeps failing, is marked stuck in the queue (never dropped by a run); the
// device purge (ADR-0018) ends a run at its next step. writes hold personal data: never logged,
// never put in an error or a report tag
import {
  LIBRARY_REPLAY_BATCH_SIZE,
  libraryQueuedWriteKey,
  type LibraryReplayOutcome,
} from '../../domain/library-sync';
import type { MediaKey } from '../../domain/media';
import type { ErrorReporter } from '../../errors/error-reporter';
import { LIBRARY_REPLAY_REPORT_SOURCE, LibraryRemoteError } from '../../errors/library-errors';
import type { LibraryCallOptions, RemoteAccountLibraryRepository } from '../library-repository';
import type { LibraryReplayRun } from '../offline-account-library-repository';
import type { QueuedWriteRecord } from './account-library-documents';
import {
  confirmState,
  isClosed,
  isReplayable,
  notifySyncState,
  recordId,
  type ReplayRunState,
  type UserCoordination,
} from './account-library-coordination';
import { refreshKeptKeys } from './account-library-refresh';
import { waitUnlessAborted } from './account-library-wait';

const FIRST_RETRY_DELAY_MS = 2_000;
const SECOND_RETRY_DELAY_MS = 10_000;
const THIRD_RETRY_DELAY_MS = 30_000;

/**
 * the waits before each retry of a run failing with `network` or `unknown`: three retries per run,
 * then the run ends `failed` and the queue waits for the next trigger.
 */
export const LIBRARY_REPLAY_RETRY_DELAYS_MS: readonly number[] = [
  FIRST_RETRY_DELAY_MS,
  SECOND_RETRY_DELAY_MS,
  THIRD_RETRY_DELAY_MS,
];

/** what a run needs: the user's coordination, the account store, the connectivity, a reporter. */
export interface ReplayContext {
  readonly coordination: UserCoordination;
  readonly remote: RemoteAccountLibraryRepository;
  readonly isOnline: () => boolean;
  readonly reporter: ErrorReporter;
}

type RunStatus = LibraryReplayRun['status'];

// what one call of the replay gave the run
type BatchResult =
  | { readonly type: 'confirmed'; readonly count: number; readonly kept: readonly MediaKey[] }
  | { readonly type: 'retry'; readonly reason: 'network' | 'unknown' }
  | { readonly type: 'split' }
  | { readonly type: 'refused' }
  | { readonly type: 'end'; readonly status: RunStatus };

const FAILED: BatchResult = { type: 'end', status: 'failed' };
const SIGNED_OUT: BatchResult = { type: 'end', status: 'signed-out' };

// the next batch: a write of the keys a refused batch split, alone, else up to a batch of the
// replayable writes by ascending seq, as the queue stands now
const pickBatch = (
  coordination: UserCoordination,
  singles: ReadonlySet<string>,
): readonly QueuedWriteRecord[] => {
  const replayable = coordination.store
    .readRecords()
    .filter((record) => isReplayable(coordination, record));
  const single = replayable.find((record) => singles.has(recordId(record)));
  return single === undefined ? replayable.slice(0, LIBRARY_REPLAY_BATCH_SIZE) : [single];
};

// confirms the sent writes: each leaves the queue unless a newer write of its key replaced it,
// and the copy takes the state of each `written` one (the keys of the `kept` ones are read again)
const applyOutcomes = (
  coordination: UserCoordination,
  batch: readonly QueuedWriteRecord[],
  outcomes: readonly LibraryReplayOutcome[],
): BatchResult => {
  if (outcomes.length !== batch.length) {
    throw new RangeError('library replay answered another number of writes');
  }
  const count = coordination.store.removeConfirmed(batch);
  const kept: MediaKey[] = [];
  batch.forEach(({ write }, index) => {
    const key = libraryQueuedWriteKey(write);
    if (outcomes[index] === 'written') {
      confirmState(coordination, key, write.type === 'save' ? write.entry : null);
    } else {
      kept.push(key);
    }
  });
  return { type: 'confirmed', count, kept };
};

const failureOf = (
  { coordination, reporter }: ReplayContext,
  batch: readonly QueuedWriteRecord[],
  error: unknown,
): BatchResult => {
  const reason = error instanceof LibraryRemoteError ? error.reason : null;
  // transient, a 408 or a 429 included (network): retried with backoff, never split nor refused
  if (reason === 'network' || reason === 'unknown') {
    return { type: 'retry', reason };
  }
  if (reason === 'signed-out') {
    return { type: 'end', status: 'signed-out' };
  }
  const [first] = batch;
  // refused for good: a bug, or a new entry past the user's cap (library-full), which the writes
  // of stored keys and the removals of the batch do not need, so they are sent alone
  if ((reason === 'rejected' || reason === 'library-full') && first !== undefined) {
    if (batch.length > 1) {
      return { type: 'split' };
    }
    // refused alone: kept in the queue, marked refused, never sent again by a run until a retry
    // releases it or a newer write of its key replaces it
    coordination.released.delete(recordId(first));
    if (coordination.store.markRefused(first)) {
      notifySyncState(coordination);
    }
    return { type: 'refused' };
  }
  // a bug: the queue holds valid writes only, and the replay never answers an unreadable row
  reporter.captureError(error, { source: LIBRARY_REPLAY_REPORT_SOURCE });
  return FAILED;
};

const sendBatch = async (
  context: ReplayContext,
  batch: readonly QueuedWriteRecord[],
): Promise<BatchResult> => {
  const { coordination, remote } = context;
  const ids = batch.map(recordId);
  for (const id of ids) {
    coordination.sendingKeys.add(id);
  }
  try {
    const outcomes = await remote.replayWrites(batch.map(({ write }) => write));
    // purged while the batch was in flight: its outcome is not stored
    if (isClosed(coordination)) {
      return SIGNED_OUT;
    }
    return applyOutcomes(coordination, batch, outcomes);
  } catch (error) {
    // likewise for its failure: nothing is retried, refused or reported
    return isClosed(coordination) ? SIGNED_OUT : failureOf(context, batch, error);
  } finally {
    for (const id of ids) {
      coordination.sendingKeys.delete(id);
    }
  }
};

const runReplay = async (
  context: ReplayContext,
  state: ReplayRunState,
  signal: AbortSignal | undefined,
): Promise<LibraryReplayRun> => {
  const { coordination, isOnline } = context;
  let confirmed = 0;
  let retries = 0;
  // the keys of a batch the database refused, sent again one write per call
  const singles = new Set<string>();
  // the run stops being in flight in the synchronous step that ends it (one run per user at a
  // time: the run in flight is this one)
  const end = (status: RunStatus): LibraryReplayRun => {
    coordination.run = null;
    return { status, confirmed };
  };
  for (;;) {
    if (state.aborted) {
      return end('aborted');
    }
    if (!isOnline()) {
      return end('offline');
    }
    const batch = pickBatch(coordination, singles);
    if (batch.length === 0) {
      return end('done');
    }
    const result = await sendBatch(context, batch);
    if (result.type === 'end') {
      return end(result.status);
    }
    if (result.type === 'retry') {
      const delay = LIBRARY_REPLAY_RETRY_DELAYS_MS[retries];
      if (delay === undefined) {
        // a lasting server failure, never a lost connection: the writes sent count it
        if (result.reason === 'unknown') {
          coordination.store.countFailedRun(batch);
        }
        return end('failed');
      }
      retries += 1;
      if (!(await waitUnlessAborted(delay, signal, coordination.closer.signal))) {
        return end(isClosed(coordination) ? 'signed-out' : 'aborted');
      }
    }
    for (const id of batch.map(recordId)) {
      if (result.type === 'split') {
        singles.add(id);
      } else if (result.type !== 'retry') {
        singles.delete(id);
      }
    }
    if (result.type === 'confirmed') {
      confirmed += result.count;
      await refreshKeptKeys(context, result.kept, () => state.aborted);
      // purged during the refresh
      if (isClosed(coordination)) {
        return end('signed-out');
      }
    }
  }
};

// starts a run, in flight for the user until the step that ends it
const startRun = (context: ReplayContext, signal: AbortSignal | undefined) => {
  const { coordination, reporter } = context;
  let settle: (run: LibraryReplayRun) => void = () => undefined;
  const state: ReplayRunState = {
    promise: new Promise((resolve) => {
      settle = resolve;
    }),
    aborted: false,
  };
  const onAbort = (): void => {
    state.aborted = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  coordination.run = state;
  void runReplay(context, state, signal)
    .catch((error: unknown): LibraryReplayRun => {
      // a storage failure: the queue is kept, the next trigger tries again
      coordination.run = null;
      reporter.captureError(error, { source: LIBRARY_REPLAY_REPORT_SOURCE });
      return { status: 'failed', confirmed: 0 };
    })
    .then((run) => {
      signal?.removeEventListener('abort', onAbort);
      settle(run);
      // a run ended: its writes may have been confirmed, counted or refused
      notifySyncState(coordination);
    });
  return state.promise;
};

/**
 * the OfflineAccountLibraryRepository `replayQueuedWrites` of the user of `context` (its
 * contract is in ../offline-account-library-repository.ts): joins the run in flight, waits for an
 * aborted one to settle and then starts or joins the next, or starts one. a signal aborted at the
 * call ends at once; once the device purge closed the coordination, nothing is sent.
 */
export const replayQueuedWrites = (
  context: ReplayContext,
  options: LibraryCallOptions = {},
): Promise<LibraryReplayRun> => {
  const { signal } = options;
  if (isClosed(context.coordination)) {
    return Promise.resolve({ status: 'signed-out', confirmed: 0 });
  }
  if (signal?.aborted === true) {
    return Promise.resolve({ status: 'aborted', confirmed: 0 });
  }
  const current = context.coordination.run;
  if (current === null) {
    return startRun(context, signal);
  }
  return current.aborted
    ? current.promise.then(() => replayQueuedWrites(context, options))
    : current.promise;
};
