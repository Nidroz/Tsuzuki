import { useMutation } from '@tanstack/react-query';

import type { ErrorReporter } from '../errors/error-reporter';
import type { OfflineAccountLibraryRepository } from '../repositories/library-repository';
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

/** the sync steps of a sign out: the flush of the live writer, the replay of the queued writes */
export type SignOutSyncStep = 'flush' | 'replay';

const SIGN_OUT_SYNC_MESSAGES: Readonly<Record<SignOutSyncStep, string>> = {
  flush: 'Sign out sync failed: flush',
  replay: 'Sign out sync failed: replay',
};

/**
 * a sync step of a sign out that failed, as reported; it holds the step only. the message is fixed
 * and no cause is attached, since a storage error could quote stored content
 */
export class SignOutSyncError extends Error {
  readonly step: SignOutSyncStep;

  constructor(step: SignOutSyncStep) {
    super(SIGN_OUT_SYNC_MESSAGES[step]);
    this.name = 'SignOutSyncError';
    this.step = step;
  }
}

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
 * resolving a SignOutResult: (1) the session's account instance is taken as the call starts, none
 * signs out only; (2) within SIGN_OUT_SYNC_TIMEOUT_MS: the live library writer is flushed, the
 * account's queued writes are replayed, then the writer is flushed again for a change made during
 * the replay; the writer only once the merge concluded (the live library is the account), the
 * replay whatever the merge status; a failed step is reported (SignOutSyncError); (3) writes still
 * queued or changes the live writer still holds, and no `discardUnsynced`: `{ status: 'unsynced',
 * count }` and nothing else; (4) whether the guest library is kept is read from the latest merge
 * status; (5) `signOut()`: a rejection (an AuthError, `network` when the session must stay)
 * rejects, nothing purged; (6) the device purge, the queue included. read inside every provider of
 * the composition root. residual: a change made while the `signOut()` request itself is in flight
 * (after the count, or after the user's confirmation) is not sent: the purge drops it
 */
export const useSignOut = () => {
  const { repository } = useAuthContext();
  const { account } = useSessionLibrary();
  const library = useLibraryContext();
  const { status } = useGuestMerge();
  const { reporter } = useDevicePurgeContext();
  const purge = useDevicePurge();
  const latest = useLatest({ account, library, status });
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: async ({ discardUnsynced = false }: SignOutOptions): Promise<SignOutResult> => {
      const sessionAccount = latest.current.account;
      if (sessionAccount === null) {
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
      await repository.signOut();
      await purge({ account: sessionAccount, clearGuestLibrary });
      return SIGNED_OUT;
    },
  });
};
