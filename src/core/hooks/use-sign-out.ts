import { useMutation } from '@tanstack/react-query';

import type { ErrorReporter } from '../errors/error-reporter';
import { SignOutSyncError, type SignOutSyncStep } from '../errors/sign-out-errors';
import type { OfflineAccountLibraryRepository } from '../repositories/offline-account-library-repository';
import type { AuthSessionState } from './auth-context';
import { keepsGuestLibrary } from './device-purge';
import type { GuestMergeStatus } from './guest-merge-context';
import type { LibraryContextValue } from './library-context';
import type { LibraryWriter } from './library-writer';
import { useSessionLibrary } from './session-library-context';
import { AUTH_MUTATION_OPTIONS } from './use-auth-mutations';
import { useAuthContext } from './use-auth-context';
import { useDevicePurge, useDevicePurgeContext } from './use-device-purge';
import { useGuestMerge } from './use-guest-merge';
import { useLatest } from './use-latest';
import { useLibraryContext } from './use-library-context';

/**
 * how long a sign out waits for the flush of the live writer and the replay of the queued writes
 * together: a replay run joined from the replay driver may sit in its 30 s backoff
 */
export const SIGN_OUT_SYNC_TIMEOUT_MS = 10_000;

const REPORT_SOURCE = 'sign-out';

export interface SignOutOptions {
  /** the user confirmed losing the writes still queued after the sync: they are purged */
  readonly discardUnsynced?: boolean;
}

export type SignOutResult =
  | { readonly status: 'signed-out' }
  /**
   * writes still queued, or changes the live writer still holds, after the sync: nothing was
   * done, the user is asked first
   */
  | { readonly status: 'unsynced'; readonly count: number };

const SIGNED_OUT: SignOutResult = Object.freeze({ status: 'signed-out' });

// a sync step that failed is reported, never with its error, and the sign out goes on: the count
// tells what remains
const settleStep = async (
  reporter: ErrorReporter,
  step: SignOutSyncStep,
  call: () => Promise<unknown>,
): Promise<void> => {
  try {
    await call();
  } catch {
    reporter.captureError(new SignOutSyncError(step), { source: REPORT_SOURCE, tags: { step } });
  }
};

// the live writer once it writes to the account of the session: the merge concluded. before that
// it is the pending library's, whose reads never settle and which holds no change
const accountWriterOf = (
  account: OfflineAccountLibraryRepository,
  { library, status }: { readonly library: LibraryContextValue; readonly status: GuestMergeStatus },
): LibraryWriter | null =>
  status === 'idle' && library.repository === account ? library.writer : null;

// the session state as the auth repository last reported it (readState), read once `signOut()`
// settled: only a report changes what the sign out does. the device-wide data (recent searches,
// caches, the guest library its merge reads) of another user's session is theirs: the purge then
// takes this user's documents only, as the launch purges do (DevicePurgeDriver)
const isOtherUserSignedIn = (state: AuthSessionState, userId: string): boolean =>
  state.status === 'signed-in' && state.session.userId !== userId;

// the session ended, or another user's started: not this user's any more
const hasSessionEnded = (state: AuthSessionState, userId: string): boolean =>
  state.status === 'signed-out' || isOtherUserSignedIn(state, userId);

// a new report of `userId` signed in since `before` was read: a token refresh keeps the state
// object, a sign out then a sign in replaces it
const isSignedInAgain = (
  state: AuthSessionState,
  before: AuthSessionState,
  userId: string,
): boolean => state !== before && state.status === 'signed-in' && state.session.userId === userId;

// runs `task` until it settles or `budgetMs` passed, whichever comes first; at the budget its
// signal aborts and nothing waits for it any more
const runWithin = async (
  budgetMs: number,
  task: (signal: AbortSignal) => Promise<void>,
): Promise<void> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, budgetMs);
  });
  try {
    await Promise.race([task(controller.signal), budget]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * signs out on this device (FR-25, ADR-0018 "Sign out"), a mutation taking SignOutOptions and
 * resolving a SignOutResult: (1) the session's account instance and user id are taken as the call
 * starts, none signs out only; (2) within SIGN_OUT_SYNC_TIMEOUT_MS: the live library writer is
 * flushed, the account's queued writes are replayed, then the writer is flushed again for a change
 * made during the replay; the writer only once the merge concluded (the live library is the
 * account), the replay whatever the merge status; a failed step is reported (SignOutSyncError);
 * (3) writes still queued or changes the live writer still holds, and no `discardUnsynced`:
 * `{ status: 'unsynced', count }` and nothing else; (4) whether the guest library is kept is read
 * from the latest merge status; (5) the user's purge-pending marker is written (ADR-0018, update of
 * 2026-11-04), then `signOut()`. the session is then read as the auth repository last reported it
 * (readState): a rejection (an AuthError, `network` when the session must stay) while the session
 * is still this user's removes the marker and rejects, nothing purged; a rejection once the
 * session ended (or another user's started) goes on as a success; (6) the device purge, the queue
 * included, unless this user was reported signed in again meanwhile (the marker is then removed,
 * nothing purged), its device-wide steps unless another user is signed in; then the marker is
 * removed, or rewritten for a retry at the next launch when the `account-library` step failed,
 * unless this user was reported signed in again during the purge (removed). a marker failure is
 * reported, never blocks the sign out. read inside every provider of the composition root.
 * residual: a change made while the `signOut()` request itself is in flight (after the count, or
 * after the user's confirmation) is not sent: the purge drops it
 */
export const useSignOut = () => {
  const { repository, readState } = useAuthContext();
  // `userId` is the user of `account`: both come from the same session
  const { account, userId } = useSessionLibrary();
  const library = useLibraryContext();
  const { status } = useGuestMerge();
  const { reporter, markers } = useDevicePurgeContext();
  const purge = useDevicePurge();
  const latest = useLatest({ account, userId, library, status });
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: async ({ discardUnsynced = false }: SignOutOptions): Promise<SignOutResult> => {
      const { account: sessionAccount, userId: sessionUserId } = latest.current;
      if (sessionAccount === null || sessionUserId === null) {
        await repository.signOut();
        return SIGNED_OUT;
      }
      // the writer read as each step starts: the merge may conclude meanwhile
      const flushLiveWriter = async (): Promise<void> => {
        const writer = accountWriterOf(sessionAccount, latest.current);
        if (writer !== null) {
          await settleStep(reporter, 'flush', () => writer.flushAll());
        }
      };
      await runWithin(SIGN_OUT_SYNC_TIMEOUT_MS, async (signal) => {
        await flushLiveWriter();
        if (!signal.aborted) {
          await settleStep(reporter, 'replay', () => sessionAccount.replayQueuedWrites({ signal }));
        }
        // a change made while the replay ran, still in its coalescing window
        if (!signal.aborted) {
          await flushLiveWriter();
        }
      });
      if (!discardUnsynced) {
        const held = accountWriterOf(sessionAccount, latest.current)?.pendingChangeCount() ?? 0;
        const count = sessionAccount.queuedWriteCount() + held;
        if (count > 0) {
          return { status: 'unsynced', count };
        }
      }
      // before the session ends: the status reads `idle` once signed out
      const clearGuestLibrary = !keepsGuestLibrary(latest.current.status);
      // a kill between the end of the session and the purge leaves the marker: the next launch
      // purges this user's documents
      markers.add({ userId: sessionUserId, clearGuestLibrary, deviceWide: true });
      const before = readState();
      try {
        await repository.signOut();
      } catch (error) {
        if (!hasSessionEnded(readState(), sessionUserId)) {
          // still signed in: nothing is owed
          markers.remove(sessionUserId);
          throw error;
        }
        // the session is gone anyway (a failed session read after a server failure, once
        // supabase-js removed it): the marker stays and the purge runs now, as after a success.
        // it is what the user asked, and waiting for the next launch would leave this user's
        // notes, queue, recent searches and caches on a device shown signed out meanwhile. the
        // call resolves: the user is signed out, the repository reported an `unknown` failure
        // itself, and any other reason is expected (the revocation failed offline)
      }
      // signed in again before the purge (the session ended inside `signOut()`, then a sign in of
      // the same user was reported): that sign out did not stand, and the purge would close the
      // new session's account instances (every instance of the user) and delete its writes. the
      // check and the account-library step run in one synchronous step, and that instance is
      // created by the render that follows the report: none exists when the check passes
      if (isSignedInAgain(readState(), before, sessionUserId)) {
        markers.remove(sessionUserId);
        return SIGNED_OUT;
      }
      const failed = await purge({
        account: sessionAccount,
        clearGuestLibrary,
        deviceWide: !isOtherUserSignedIn(readState(), sessionUserId),
      });
      // signed in again while the purge ran: nothing is owed, and a marker kept would purge them
      // at a launch that reads as signed out (DevicePurgeDriver)
      if (isSignedInAgain(readState(), before, sessionUserId)) {
        markers.remove(sessionUserId);
      } else {
        markers.settle(sessionUserId, failed);
      }
      return SIGNED_OUT;
    },
  });
};
