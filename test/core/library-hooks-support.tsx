// wrappers giving the library hooks a query client and a library repository, and catalog data
// of the media of ENTRY_KEY, for the library hook tests (src/core/hooks/); the session library
// over a session the test drives, for the session library and guest merge tests
import { expect, jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { flushSessionReports } from './auth-hooks-support';
import { createSessionAuthRepository, createSessionSource } from './fake-auth-repository';
import {
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from './fake-library-repository';
import { ENTRY_KEY, SNAPSHOT, TITLE_TEXT } from './library-entry-fixtures';
import { createFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { MediaSummary } from '@core/catalog/catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { createQueryClient } from '@core/query/query-client';
import { noCaptcha, type AuthSession } from '@core/repositories/auth-repository';
import type {
  LibraryReplayRun,
  LibraryRepository,
  OfflineAccountLibraryRepository,
} from '@core/repositories/library-repository';
import type { ForegroundSubscription } from '@core/hooks/foreground';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import type { GuestMergeStatus } from '@core/hooks/guest-merge-context';
import {
  LibraryContextProvider,
  type LibraryContextProviderProps,
} from '@core/hooks/LibraryContextProvider';
import {
  PENDING_LIBRARY_REPOSITORY,
  SessionLibraryContextProvider,
} from '@core/hooks/SessionLibraryContextProvider';
import { useGuestMerge } from '@core/hooks/use-guest-merge';
import { useLibraryContext } from '@core/hooks/use-library-context';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';

/** the catalog data of the media of ENTRY_KEY, whose snapshot is SNAPSHOT */
export const MEDIA: MediaSummary = {
  key: ENTRY_KEY,
  title: TITLE_TEXT,
  titleEnglish: null,
  imageUrl: SNAPSHOT.imageUrl,
  format: SNAPSHOT.format,
  status: 'finished',
  totalUnits: SNAPSHOT.totalUnits,
  score: null,
  year: null,
  genres: [],
  isAdult: SNAPSHOT.isAdult,
};

/** a total that changed in the catalog since the snapshot was taken */
export const FRESH_TOTAL = 40;
export const FRESH_MEDIA: MediaSummary = { ...MEDIA, totalUnits: FRESH_TOTAL };

/** a media no snapshot can hold: a title is at least one character (the database limits) */
export const UNSTORABLE_MEDIA: MediaSummary = { ...MEDIA, title: '' };

export const libraryWrapper =
  (queryClient: QueryClient, repository: LibraryRepository) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
    </QueryClientProvider>
  );

type OnRetired = LibraryContextProviderProps['onRetired'];

/**
 * libraryWrapper whose repository a test switches, as the session library switch does (A-03):
 * `switchTo(next)` then a rerender gives the hooks a new repository, writer and cache scope;
 * `setOnRetired(next)` then a rerender gives the provider another `onRetired`. with a fake catalog
 * provider, for useLibraryList
 */
export const switchableLibraryWrapper = (
  queryClient: QueryClient,
  initial: LibraryRepository,
  onRetired?: OnRetired,
) => {
  const current: { repository: LibraryRepository; onRetired: OnRetired } = {
    repository: initial,
    onRetired,
  };
  const provider = createFakeCatalogProvider();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>
        <LibraryContextProvider
          repository={current.repository}
          {...(current.onRetired !== undefined && { onRetired: current.onRetired })}
        >
          {children}
        </LibraryContextProvider>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
  const switchTo = (next: LibraryRepository): void => {
    current.repository = next;
  };
  const setOnRetired = (next: OnRetired): void => {
    current.onRetired = next;
  };
  return { wrapper, switchTo, setOnRetired };
};

export interface EntryHookProps {
  readonly media: MediaSummary | null;
}

/**
 * the entry of ENTRY_KEY and its actions, rendered over a fake repository holding `initial`,
 * with `media` as the catalog data (a prop, so a test can change it)
 */
export const renderLibraryEntry = (
  initial: readonly LibraryEntry[],
  media: MediaSummary | null = MEDIA,
) => {
  const queryClient = createQueryClient();
  const repository: FakeLibraryRepository = createFakeLibraryRepository(initial);
  const rendered = renderHook(
    (props: EntryHookProps) => ({
      entry: useLibraryEntry(ENTRY_KEY, props),
      actions: useLibraryEntryActions({ ...ENTRY_KEY }, props),
    }),
    { initialProps: { media }, wrapper: libraryWrapper(queryClient, repository) },
  );
  return { ...rendered, queryClient, repository };
};

/** the options of every guest merge call: the signal of its run */
export const MERGE_OPTIONS = { signal: expect.any(AbortSignal) };

/** a replay run that found nothing to send */
export const NOTHING_REPLAYED: LibraryReplayRun = { status: 'done', confirmed: 0 };

/**
 * the fake account repository as the offline account library the session library gets: its
 * `replayQueuedWrites` resolves NOTHING_REPLAYED by default (a jest mock a test sets up), and
 * `notifyQueued()` calls every listener of `subscribeToQueuedWrites`, as a write left in the queue
 * does
 */
export const createSessionAccount = (initial: readonly LibraryEntry[] = []) => {
  const listeners = new Set<() => void>();
  return {
    ...createFakeAccountLibraryRepository(initial),
    replayQueuedWrites: jest.fn<OfflineAccountLibraryRepository['replayQueuedWrites']>(() =>
      Promise.resolve(NOTHING_REPLAYED),
    ),
    subscribeToQueuedWrites: jest.fn<OfflineAccountLibraryRepository['subscribeToQueuedWrites']>(
      (listener) => {
        const subscription = (): void => {
          listener();
        };
        listeners.add(subscription);
        return () => {
          listeners.delete(subscription);
        };
      },
    ),
    notifyQueued: (): void => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
};

export type FakeSessionAccount = ReturnType<typeof createSessionAccount>;

/**
 * a ForegroundSubscription a test drives: `change(foreground)` calls every listener, which first
 * hears `initial` as it subscribes, as src/platform/app-state.ts does
 */
export const createForegroundSource = (initial = true) => {
  const listeners = new Set<(foreground: boolean) => void>();
  const subscribe = jest.fn<ForegroundSubscription>((listener) => {
    listeners.add(listener);
    listener(initial);
    return () => {
      listeners.delete(listener);
    };
  });
  const change = (foreground: boolean): void => {
    for (const listener of [...listeners]) {
      listener(foreground);
    }
  };
  return { subscribe, change, listenerCount: () => listeners.size };
};

/** placeholder user ids */
export const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

/** what one committed render under the session library showed */
export interface SessionLibraryFrame {
  readonly repository: LibraryRepository;
  readonly status: GuestMergeStatus;
  /** the entry of ENTRY_KEY: undefined while it loads */
  readonly entry: LibraryEntry | null | undefined;
}

export interface SessionLibrarySetup {
  /** the session reported once the provider subscribes; `loading`: never reported */
  readonly session?: AuthSession | null | 'loading';
  readonly guestEntries?: readonly LibraryEntry[];
  /** the entries of each user's account library, empty for a user left out */
  readonly accountEntries?: ReadonlyMap<string, readonly LibraryEntry[]>;
  /** called with each account repository as it is created, before any call reaches it */
  readonly onAccount?: (userId: string, account: FakeSessionAccount) => void;
  /** the catalog data the entry hooks get (MEDIA: add has a snapshot to write), null by default */
  readonly media?: MediaSummary | null;
  /** the app foreground the provider gets, none by default */
  readonly subscribeToForeground?: ForegroundSubscription;
  /** renders under StrictMode, which runs the effect cleanups of the first mount once more */
  readonly strictMode?: boolean;
}

const neverReports = (): (() => void) => () => undefined;

/**
 * renders SessionLibraryContextProvider over a session the test drives (`emit`), a fake guest
 * library and a new fake account library (createSessionAccount) per accountRepositoryFor call,
 * with a recording reporter and `subscribeToForeground` when given.
 * the hook reads the library, the merge status and the entry of ENTRY_KEY with its actions (with
 * `media` as the catalog data), and records each committed render in `frames`. resolves once the
 * initial session was reported
 */
export const renderSessionLibrary = async ({
  session = null,
  guestEntries = [],
  accountEntries = new Map<string, readonly LibraryEntry[]>(),
  onAccount,
  media = null,
  subscribeToForeground,
  strictMode = false,
}: SessionLibrarySetup = {}) => {
  const source = createSessionSource(session === 'loading' ? null : session);
  const auth = createSessionAuthRepository(null, {
    onAuthStateChange: session === 'loading' ? neverReports : source.subscribe,
  });
  const guest = createFakeGuestLibraryRepository(guestEntries);
  const accountRepositoryFor = jest.fn((userId: string): FakeSessionAccount => {
    const account = createSessionAccount(accountEntries.get(userId) ?? []);
    onAccount?.(userId, account);
    return account;
  });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  // the reporter prop, which replaceReporter changes
  const current: { reporter: ErrorReporter } = { reporter: { captureError } };
  const queryClient = createQueryClient();
  const frames: SessionLibraryFrame[] = [];
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={auth} captcha={noCaptcha}>
        <SessionLibraryContextProvider
          guest={guest}
          accountRepositoryFor={accountRepositoryFor}
          reporter={current.reporter}
          subscribeToForeground={subscribeToForeground}
        >
          {children}
        </SessionLibraryContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(
    () => {
      const { repository } = useLibraryContext();
      const merge = useGuestMerge();
      const entry = useLibraryEntry(ENTRY_KEY, { media });
      const actions = useLibraryEntryActions(ENTRY_KEY, { media });
      useEffect(() => {
        frames.push({ repository, status: merge.status, entry: entry.data });
      });
      return { repository, merge, entry, actions };
    },
    { wrapper, reactStrictMode: strictMode },
  );
  await flushSessionReports();

  /**
   * reports another session (a sign in, a sign out, another user, a token refresh), then lets the
   * calls it starts settle inside act: a merge step never updates the provider outside of it
   */
  const emit = async (next: AuthSession | null): Promise<void> => {
    await act(async () => {
      source.emit(next);
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  /** the account repository created by the nth accountRepositoryFor call (0 first) */
  const accountOf = (call: number): FakeSessionAccount => {
    const result = accountRepositoryFor.mock.results[call];
    if (result?.type !== 'return') {
      throw new Error('no account repository was created');
    }
    return result.value;
  };
  const nameOf = (repository: LibraryRepository): string => {
    if (repository === PENDING_LIBRARY_REPOSITORY) {
      return 'pending';
    }
    if (repository === guest) {
      return 'guest';
    }
    const call = accountRepositoryFor.mock.results.findIndex(
      (result) => result.type === 'return' && result.value === repository,
    );
    return `account ${String(call)}`;
  };
  /**
   * the frames since the nth one (0 first) as `<status> <library>`, the library `pending`,
   * `guest` or `account <n>` (accountOf(n)), a frame equal to the previous one left out
   */
  const shownSince = (from: number): readonly string[] => {
    const shown = frames.slice(from).map((frame) => `${frame.status} ${nameOf(frame.repository)}`);
    return shown.filter((label, index) => index === 0 || label !== shown[index - 1]);
  };
  /** rerenders the provider with another reporter prop, the session and libraries kept */
  const replaceReporter = (next: ErrorReporter): void => {
    act(() => {
      current.reporter = next;
      rendered.rerender();
    });
  };
  return {
    ...rendered,
    replaceReporter,
    guest,
    accountRepositoryFor,
    accountOf,
    captureError,
    frames,
    shownSince,
    emit,
  };
};

export type RenderedSessionLibrary = Awaited<ReturnType<typeof renderSessionLibrary>>;

/** lets the pending calls settle, after `ms` of fake time */
export const settleSession = async (ms = 0): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};
