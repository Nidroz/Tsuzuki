// the refresh of the keys a replay batch confirmed as `kept` (ADR-0017 "`kept` replay"): the
// server holds a newer copy than the queued write, so each key is read again inside the run and
// the device copy takes the answer through the confirmation path. entries hold personal data:
// never logged, never in an error or a report tag
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryEntryId } from '../../domain/library-view';
import type { MediaKey } from '../../domain/media';
import type { ErrorReporter } from '../../errors/error-reporter';
import { LIBRARY_REPLAY_REPORT_SOURCE, LibraryRemoteError } from '../../errors/library-errors';
import type { RemoteAccountLibraryRepository } from '../library-repository';
import {
  beginRead,
  confirmState,
  endRead,
  isClosed,
  type UserCoordination,
} from './account-library-coordination';

/** what a refresh needs: the user's coordination, the account store and a reporter. */
export interface RefreshContext {
  readonly coordination: UserCoordination;
  readonly remote: RemoteAccountLibraryRepository;
  readonly reporter: ErrorReporter;
}

// failures that the next keys would meet too: the refresh stops
const STOPPING_REASONS: ReadonlySet<string> = new Set(['network', 'signed-out']);

// reads `key` again: its answer, `skip` when the copy keeps its entry (the read failed, or a newer
// state was confirmed meanwhile), `stop` when the next keys would fail too
const readAgain = async (
  { coordination, remote, reporter }: RefreshContext,
  key: MediaKey,
): Promise<{ readonly entry: LibraryEntry | null } | 'skip' | 'stop'> => {
  const mark = beginRead(coordination);
  try {
    const entry = await remote.get(key);
    // a state of the key confirmed while the read was in flight is newer than the one read
    return endRead(coordination, mark).has(libraryEntryId(key)) ? 'skip' : { entry };
  } catch (error) {
    endRead(coordination, mark);
    if (!(error instanceof LibraryRemoteError)) {
      // a bug of the account store, which maps its failures; it reports the mapped ones itself
      reporter.captureError(error, { source: LIBRARY_REPLAY_REPORT_SOURCE });
      return 'skip';
    }
    return STOPPING_REASONS.has(error.reason) ? 'stop' : 'skip';
  }
};

/**
 * reads each of `keys` again, one after the other, while `isStopped()` is false and the
 * coordination is open: an existing copy takes each answer (never created by it), and a read in
 * flight keeps it. a failed read leaves the copy entry of its key as it was; `network` or
 * `signed-out` stops the refresh of the remaining keys. never rejects for a failure of the server.
 */
export const refreshKeptKeys = async (
  context: RefreshContext,
  keys: readonly MediaKey[],
  isStopped: () => boolean,
): Promise<void> => {
  const { coordination } = context;
  for (const key of keys) {
    if (isStopped()) {
      return;
    }
    const answer = await readAgain(context, key);
    // purged during the read: its answer is not stored, and no further key is read
    if (answer === 'stop' || isClosed(coordination)) {
      return;
    }
    if (answer !== 'skip') {
      confirmState(coordination, key, answer.entry);
    }
  }
};
