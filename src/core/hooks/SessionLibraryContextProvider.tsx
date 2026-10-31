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
import type {
  AccountLibraryRepository,
  GuestLibraryRepository,
  LibraryRepository,
} from '../repositories/library-repository';
import { mergeGuestLibrary } from './guest-merge';
import {
  GuestMergeContext,
  type GuestMergeStatus,
  type GuestMergeValue,
} from './guest-merge-context';
import { LibraryContextProvider, type RetiredLibrary } from './LibraryContextProvider';
import { useAuthSession } from './use-auth-session';

export interface SessionLibraryContextProviderProps {
  /** the guest library, shown signed out and merged at sign in; pass a stable object (module level) */
  guest: GuestLibraryRepository;
  /**
   * the account library of a signed-in user id, called once per user id while signed in; pass a
   * stable function (module level)
   */
  accountRepositoryFor: (userId: string) => AccountLibraryRepository;
  /** receives the merge failures that are not an account store failure (those report themselves) */
  reporter: ErrorReporter;
  children: ReactNode;
}

const neverSettles = <T,>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * the library while the session is not known yet, or while the guest library is merged into the
 * account: every call stays pending, so the library screens show their loading state, never the
 * guest library to a signed-in user nor an empty one. no write reaches it: library actions wait
 * for a loaded entry, which never comes
 */
export const PENDING_LIBRARY_REPOSITORY: LibraryRepository = Object.freeze({
  list: neverSettles,
  get: neverSettles,
  save: neverSettles,
  remove: neverSettles,
});

// the merge of one account instance: the guest store read, its entries sent, a failure, or done
type MergePhase = 'checking' | 'merging' | 'failed' | 'done';

interface MergeState {
  /** the account instance this state is about; any other instance is still `checking` */
  readonly account: AccountLibraryRepository | null;
  readonly phase: MergePhase;
  /** the run of that instance: 0 for the first, one more per retry */
  readonly attempt: number;
}

interface StartedRun {
  readonly account: AccountLibraryRepository;
  readonly attempt: number;
}

const NO_MERGE: MergeState = { account: null, phase: 'done', attempt: 0 };

const REPORT_SOURCE = 'guest-merge';

const noop = (): void => undefined;

/**
 * the LibraryContextProvider of the session's library (docs/ARCHITECTURE.md §4 "Library
 * switch", ADR-0016): the guest library signed out, the account library of the user signed in
 * (one per user id: a token refresh keeps it, another user or a new sign in gets a new one), the
 * pending library while the session loads. each new account instance first gets the guest
 * library merged into it (BR-08, FR-22): the pending library while the guest store is read and
 * its entries are sent, from the very first render of that instance, then the account library,
 * with the merge status and its retry given to useGuestMerge(). a merge waits for the pending
 * writes of the retired libraries first, and one whose session ended changes and removes nothing.
 * render it inside AuthContextProvider and the query client provider
 */
export function SessionLibraryContextProvider({
  guest,
  accountRepositoryFor,
  reporter,
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
  // library never shows before its merge concluded, and no write can reach it meanwhile
  const isMergeOfAccount = account !== null && merge.account === account;
  const phase: MergePhase | null =
    account === null ? null : isMergeOfAccount ? merge.phase : 'checking';
  const attempt = isMergeOfAccount ? merge.attempt : 0;

  // the account instance of the session as committed, null once unmounted: a run started for
  // another instance is stale. set in the commit, before any effect of the same commit runs
  const liveAccountRef = useRef<AccountLibraryRepository | null>(null);
  useLayoutEffect(() => {
    liveAccountRef.current = account;
    return () => {
      liveAccountRef.current = null;
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

  const run = useCallback(
    (runAccount: AccountLibraryRepository, runAttempt: number) => {
      const isCurrent = (): boolean => liveAccountRef.current === runAccount;
      const conclude = (next: MergePhase): void => {
        if (isCurrent()) {
          setMerge({ account: runAccount, phase: next, attempt: runAttempt });
        }
      };
      mergeGuestLibrary({
        guest,
        account: runAccount,
        // called as the run starts: the flushes reported so far, the writer retired in the commit
        // that started the run included
        settleWrites: () => Promise.all([...flushesRef.current]).then(noop),
        isCurrent,
        onMerging: () => {
          conclude('merging');
        },
      }).then(
        (outcome) => {
          if (outcome !== 'stale') {
            conclude('done');
          }
        },
        (error: unknown) => {
          // reported even for a stale run, never swallowed; the account store reports its own
          // failures. the errors of the repositories hold no entry, key or user id
          if (!(error instanceof LibraryRemoteError)) {
            reporter.captureError(error, { source: REPORT_SOURCE });
          }
          conclude('failed');
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
        ? { account: current.account, phase: 'checking', attempt: current.attempt + 1 }
        : current,
    );
  }, []);

  const mergeStatus: GuestMergeStatus = phase === null || phase === 'done' ? 'idle' : phase;
  const mergeValue = useMemo(
    (): GuestMergeValue => ({ status: mergeStatus, retry }),
    [mergeStatus, retry],
  );

  let repository: LibraryRepository;
  if (account === null) {
    repository = status === 'loading' ? PENDING_LIBRARY_REPOSITORY : guest;
  } else {
    repository = phase === 'checking' || phase === 'merging' ? PENDING_LIBRARY_REPOSITORY : account;
  }

  return (
    <GuestMergeContext value={mergeValue}>
      <LibraryContextProvider repository={repository} onRetired={onRetired}>
        {children}
      </LibraryContextProvider>
    </GuestMergeContext>
  );
}
