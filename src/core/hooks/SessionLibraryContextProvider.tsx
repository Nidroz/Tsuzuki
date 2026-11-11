import { onlineManager } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ErrorReporter } from '../errors/error-reporter';
import { LibraryRemoteError } from '../errors/library-errors';
import { LibraryCleanupError } from '../errors/library-report-errors';
import type { GuestLibraryRepository, LibraryRepository } from '../repositories/library-repository';
import type { OfflineAccountLibraryRepository } from '../repositories/offline-account-library-repository';
import type { ForegroundSubscription } from './foreground';
import { guestMergeFailureOf, mergeGuestLibrary } from './guest-merge';
import {
  GuestMergeContext,
  type GuestMergeFailure,
  type GuestMergeStatus,
  type GuestMergeValue,
} from './guest-merge-context';
import { LibraryContextProvider, type RetiredLibrary } from './LibraryContextProvider';
import { LibraryReplayDriver } from './LibraryReplayDriver';
import { PENDING_LIBRARY_REPOSITORY } from './pending-library';
import { SessionLibraryContext, type SessionLibraryValue } from './session-library-context';
import { useAuthSession } from './use-auth-session';

export { PENDING_LIBRARY_REPOSITORY } from './pending-library';

export interface SessionLibraryContextProviderProps {
  /** the guest library, shown signed out and merged at sign in; pass a stable object (module level) */
  guest: GuestLibraryRepository;
  /**
   * the offline account library of a signed-in user id (ADR-0017), called once per user id while
   * signed in; pass a stable function (module level)
   */
  accountRepositoryFor: (userId: string) => OfflineAccountLibraryRepository;
  /**
   * receives the merge failures that are not an account store failure (those report themselves),
   * a failed removal of the merged guest entries, and the replay runs that rejected
   */
  reporter: ErrorReporter;
  /**
   * the app foreground (src/platform/app-state.ts on mobile): going to the background flushes the
   * live library writer, a return to the foreground replays the queued writes. pass a stable
   * function (module level)
   */
  subscribeToForeground?: ForegroundSubscription | undefined;
  children: ReactNode;
}

// the merge of one account instance: the guest store read, its entries sent, a failure, or done
type MergePhase = 'checking' | 'merging' | 'failed' | 'done';

interface MergeState {
  /** the account instance this state is about; any other instance is still `checking` */
  readonly account: OfflineAccountLibraryRepository | null;
  readonly phase: MergePhase;
  /** the run of that instance: 0 for the first, one more per retry */
  readonly attempt: number;
  /** why that run failed, in the `failed` phase only */
  readonly failure: GuestMergeFailure | null;
}

interface StartedRun {
  readonly account: OfflineAccountLibraryRepository;
  readonly attempt: number;
}

const NO_MERGE: MergeState = { account: null, phase: 'done', attempt: 0, failure: null };

const REPORT_SOURCE = 'guest-merge';

const noop = (): void => undefined;

/**
 * the LibraryContextProvider of the session's library (docs/ARCHITECTURE.md §4 "Library
 * switch", ADR-0016): the guest library signed out, the account library of the user signed in
 * (one per user id: a token refresh keeps it, another user or a new sign in gets a new one), the
 * pending library while the session loads. each new account instance first gets the guest
 * library merged into it (BR-08, FR-22): the pending library from the very first render of that
 * instance until its merge succeeded (the guest store read, its entries sent, or a failure until a
 * retry succeeds), then the account library, with the merge status, why it failed (the account
 * library full or not) and its retry given to useGuestMerge(). so no library action ever computes a write on an account library lacking a
 * guest entry, which a later merge would then keep over the guest copy. a merge waits for the
 * previous merge of this provider and for the pending writes of the retired libraries first, so
 * two merges never overlap, and one whose session ended changes and removes nothing: each run's
 * signal is aborted once its account is no longer the committed one, which stops its next batch.
 * a failed merge is retried when the device reconnects, as by `retry()`; a merge whose removal of
 * the merged guest entries failed is done, the failure reported only. once the merge is done,
 * LibraryReplayDriver replays the account's queued writes (ADR-0017). useSessionLibrary() reads
 * the account instance (any merge phase) and its user id, the guest library and the factory, for
 * the sign out, the account deletion and the device purge (ADR-0018). render it inside
 * AuthContextProvider and the query client provider
 */
export function SessionLibraryContextProvider({
  guest,
  accountRepositoryFor,
  reporter,
  subscribeToForeground,
  children,
}: SessionLibraryContextProviderProps) {
  const { status, session } = useAuthSession();
  const userId = session?.userId ?? null;
  const account = useMemo(
    () => (userId === null ? null : accountRepositoryFor(userId)),
    [accountRepositoryFor, userId],
  );

  const [merge, setMerge] = useState<MergeState>(NO_MERGE);
  // derived, so the first render of a new account instance is already `checking`: the account
  // library never shows before its merge succeeded, and no write can reach it meanwhile
  const isMergeOfAccount = account !== null && merge.account === account;
  const phase: MergePhase | null =
    account === null ? null : isMergeOfAccount ? merge.phase : 'checking';
  const attempt = isMergeOfAccount ? merge.attempt : 0;

  // the account instance of the session as committed, null once unmounted: a run started for
  // another instance is stale. set in the commit, before any effect of the same commit runs
  const liveAccountRef = useRef<OfflineAccountLibraryRepository | null>(null);
  // the abort controller of the run of each account instance, until that run settled
  const runControllersRef = useRef(new Map<OfflineAccountLibraryRepository, AbortController>());
  useLayoutEffect(() => {
    liveAccountRef.current = account;
    const controllers = runControllersRef.current;
    return () => {
      liveAccountRef.current = null;
      if (account === null) {
        return;
      }
      // after the commit: a cleanup of the committed account (StrictMode) aborts nothing
      void Promise.resolve().then(() => {
        if (liveAccountRef.current !== account) {
          controllers.get(account)?.abort();
        }
      });
    };
  }, [account]);

  // the flushes of the retired library writers that have not settled yet
  const flushesRef = useRef(new Set<Promise<void>>());
  const onRetired = useCallback(({ repository, flushed }: RetiredLibrary) => {
    // the pending library's flush never settles: its reads never do, and nothing is written there
    if (repository === PENDING_LIBRARY_REPOSITORY) {
      return;
    }
    const pending = flushesRef.current;
    pending.add(flushed);
    void flushed.then(() => {
      pending.delete(flushed);
    });
  }, []);

  // the last run started, settled whatever its outcome: the next run waits for it. a stale run
  // (the same user signed in again) still passes the account store's session guard, so its later
  // batches would otherwise run next to the new run's, and could write back an entry deleted
  // meanwhile
  const lastRunRef = useRef<Promise<void>>(Promise.resolve());

  const run = useCallback(
    (runAccount: OfflineAccountLibraryRepository, runAttempt: number) => {
      const controllers = runControllersRef.current;
      const controller = new AbortController();
      controllers.set(runAccount, controller);
      const isCurrent = (): boolean => liveAccountRef.current === runAccount;
      const conclude = (next: MergePhase, failure: GuestMergeFailure | null = null): void => {
        if (isCurrent()) {
          setMerge({ account: runAccount, phase: next, attempt: runAttempt, failure });
        }
      };
      const previous = lastRunRef.current;
      const started = mergeGuestLibrary({
        guest,
        account: runAccount,
        // called as the run starts: the previous run, and the flushes reported so far, the writer
        // retired in the commit that started the run included
        settleWrites: () => Promise.all([previous, ...flushesRef.current]).then(noop),
        isCurrent,
        signal: controller.signal,
        onMerging: () => {
          conclude('merging');
        },
        // the merge is done: the account holds every listed entry or a newer copy. reported, never
        // shown, as a fixed error: the storage error could quote stored content
        onCleanupFailed: () => {
          reporter.captureError(new LibraryCleanupError('guest-merge-cleanup'), {
            source: REPORT_SOURCE,
          });
        },
      });
      lastRunRef.current = started.then(noop, noop);
      void lastRunRef.current.then(() => {
        if (controllers.get(runAccount) === controller) {
          controllers.delete(runAccount);
        }
      });
      started.then(
        (outcome) => {
          if (outcome !== 'stale') {
            conclude('done');
          }
        },
        (error: unknown) => {
          // reported even for a stale run, never swallowed; the account store reports its own
          // failures (a full account library is none). the errors of the repositories hold no
          // entry, key or user id
          if (!(error instanceof LibraryRemoteError)) {
            reporter.captureError(error, { source: REPORT_SOURCE });
          }
          conclude('failed', guestMergeFailureOf(error));
        },
      );
    },
    [guest, reporter],
  );

  // once per account instance as it becomes the session's (a launch with a stored session, a sign
  // in, another user), and once per retry. a token refresh keeps the instance and starts nothing.
  // an effect: the writers retired by this commit have reported their flush
  const startedRef = useRef<StartedRun | null>(null);
  useEffect(() => {
    if (account === null || phase !== 'checking') {
      return;
    }
    const last = startedRef.current;
    if (last?.account === account && last.attempt === attempt) {
      return;
    }
    startedRef.current = { account, attempt };
    run(account, attempt);
  }, [account, attempt, phase, run]);

  // from a failure only: a tap while a run runs, or twice in a row, starts one run at most
  const retry = useCallback(() => {
    setMerge((current) =>
      current.phase === 'failed'
        ? { ...current, phase: 'checking', attempt: current.attempt + 1, failure: null }
        : current,
    );
  }, []);

  // a failed merge needs the server: it is retried when the device reconnects
  useEffect(() => {
    if (phase !== 'failed') {
      return undefined;
    }
    return onlineManager.subscribe((online) => {
      if (online) {
        retry();
      }
    });
  }, [phase, retry]);

  const mergeStatus: GuestMergeStatus = phase === null || phase === 'done' ? 'idle' : phase;
  // the failure of this instance's run only, as the phase
  const failure = phase === 'failed' ? (merge.failure ?? 'other') : null;
  const mergeValue = useMemo(
    (): GuestMergeValue =>
      failure === null ? { status: mergeStatus, retry } : { status: mergeStatus, failure, retry },
    [mergeStatus, failure, retry],
  );

  const sessionValue = useMemo(
    (): SessionLibraryValue => ({ account, userId, guest, accountRepositoryFor }),
    [account, userId, guest, accountRepositoryFor],
  );

  let repository: LibraryRepository;
  if (account === null) {
    repository = status === 'loading' ? PENDING_LIBRARY_REPOSITORY : guest;
  } else {
    // a failed merge too: the account may lack a guest entry, and an Add or a `+1` computed on
    // that view would write an account copy newer than the guest one, which the next merge keeps
    // before removing the guest copy (its progress and notes lost)
    repository = phase === 'done' ? account : PENDING_LIBRARY_REPOSITORY;
  }

  return (
    <SessionLibraryContext value={sessionValue}>
      <GuestMergeContext value={mergeValue}>
        <LibraryContextProvider
          repository={repository}
          onRetired={onRetired}
          subscribeToForeground={subscribeToForeground}
        >
          <LibraryReplayDriver
            account={phase === 'done' ? account : null}
            reporter={reporter}
            subscribeToForeground={subscribeToForeground}
          />
          {children}
        </LibraryContextProvider>
      </GuestMergeContext>
    </SessionLibraryContext>
  );
}
