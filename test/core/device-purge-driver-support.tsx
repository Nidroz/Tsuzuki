// renders DevicePurgeContextProvider, and so its DevicePurgeDriver, inside every context the driver
// reads, with values a test drives: the session (`emit`), the users reported gone (`reportGone`),
// the guest merge status, the purge-pending markers, and the account library factory, which
// creates a fake account instance per call (createSessionAccount), recorded with its user id
import { jest } from '@jest/globals';
import { IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { flushSessionReports } from './auth-hooks-support';
import { createFakeDevicePurgeMarkers } from './fake-device-purge-markers';
import {
  createSessionAuthRepository,
  createSessionSource,
  createUserGoneSource,
} from './fake-auth-repository';
import { createFakeGuestLibraryRepository } from './fake-library-repository';
import { createFakeRecentSearchesRepository } from './fake-recent-searches-repository';
import { createSessionAccount, type FakeSessionAccount } from './session-library-support';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { DevicePurgeContextProvider } from '@core/hooks/DevicePurgeContextProvider';
import { GuestMergeContext, type GuestMergeStatus } from '@core/hooks/guest-merge-context';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import { SessionLibraryContext } from '@core/hooks/session-library-context';
import { usePurgeGeneration } from '@core/hooks/use-device-purge';
import { createQueryClient } from '@core/query/query-client';
import {
  noCaptcha,
  type AuthRepository,
  type AuthSession,
} from '@core/repositories/auth-repository';
import type { DevicePurgeMarker } from '@core/repositories/device-purge-marker-repository';

/** a query of the cache before any purge */
export const DRIVER_PROBE_QUERY_KEY = ['probe'] as const;

/** a recent search stored before any purge */
export const DRIVER_STORED_SEARCH = 'frieren';

export interface DevicePurgeDriverSetup {
  /** the session reported once the provider subscribes (signed out by default); `loading`: never */
  readonly session?: AuthSession | null | 'loading';
  /** the markers on the device at launch, none by default */
  readonly markers?: readonly DevicePurgeMarker[];
  readonly mergeStatus?: GuestMergeStatus;
  /** auth calls replacing the defaults (signOut ends the session and resolves) */
  readonly auth?: Partial<AuthRepository>;
  /** called with each account instance the factory creates, before the driver gets it */
  readonly onAccount?: (userId: string, account: FakeSessionAccount) => void;
  /** whether the persisted query cache is still being restored at first, false by default */
  readonly restoring?: boolean;
  /** what the reporter does with a report (record only by default) */
  readonly captureError?: ErrorReporter['captureError'];
}

const neverReports = (): (() => void) => () => undefined;
const ignoreRetry = (): void => undefined;

/**
 * renders usePurgeGeneration() under DevicePurgeContextProvider over `setup`, a query in the cache
 * (DRIVER_PROBE_QUERY_KEY) and a stored recent search (DRIVER_STORED_SEARCH); resolves once the
 * session was reported. the session's own account instance is not in the tree: the driver only
 * purges through new instances of the factory
 */
export const renderDevicePurgeDriver = async ({
  session = null,
  markers: initialMarkers = [],
  mergeStatus = 'idle',
  auth: overrides = {},
  onAccount,
  captureError: onReport = () => undefined,
  restoring = false,
}: DevicePurgeDriverSetup = {}) => {
  const source = createSessionSource(session === 'loading' ? null : session);
  const gone = createUserGoneSource();
  const auth = createSessionAuthRepository(null, {
    onAuthStateChange: session === 'loading' ? neverReports : source.subscribe,
    onUserGone: gone.subscribe,
    // the local sign out ends the session, as supabase-js does
    signOut: () => {
      source.emit(null);
      return Promise.resolve();
    },
    ...overrides,
  });
  const markers = createFakeDevicePurgeMarkers(initialMarkers);
  const guest = createFakeGuestLibraryRepository();
  const recentSearches = createFakeRecentSearchesRepository([DRIVER_STORED_SEARCH]);
  const removePersistedCache = jest.fn<() => void | PromiseLike<void>>();
  const captureError = jest.fn<ErrorReporter['captureError']>(onReport);
  const reporter: ErrorReporter = { captureError };
  const queryClient = createQueryClient();
  queryClient.setQueryData(DRIVER_PROBE_QUERY_KEY, 1);
  const accountRepositoryFor = jest.fn((userId: string): FakeSessionAccount => {
    const account = createSessionAccount();
    onAccount?.(userId, account);
    return account;
  });
  const sessionLibrary = { account: null, userId: null, guest, accountRepositoryFor };
  const merge = { status: mergeStatus, retry: ignoreRetry };
  // the restore state, which setRestoring changes
  const current = { restoring };

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <IsRestoringProvider value={current.restoring}>
        <AuthContextProvider repository={auth} captcha={noCaptcha}>
          <RecentSearchesContextProvider repository={recentSearches}>
            <SessionLibraryContext value={sessionLibrary}>
              <GuestMergeContext value={merge}>
                <DevicePurgeContextProvider
                  removePersistedCache={removePersistedCache}
                  reporter={reporter}
                  markers={markers}
                >
                  {children}
                </DevicePurgeContextProvider>
              </GuestMergeContext>
            </SessionLibraryContext>
          </RecentSearchesContextProvider>
        </AuthContextProvider>
      </IsRestoringProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(usePurgeGeneration, { wrapper });
  await settleDriver();

  /** the user ids the factory was called with, in order */
  const factoryCalls = (): readonly string[] =>
    accountRepositoryFor.mock.calls.map(([userId]) => userId);
  /** the account instances the factory created for `userId`, in order */
  const accountsOf = (userId: string): readonly FakeSessionAccount[] =>
    accountRepositoryFor.mock.results.flatMap((result, call) =>
      result.type === 'return' && accountRepositoryFor.mock.calls[call]?.[0] === userId
        ? [result.value]
        : [],
    );
  /** reports another session, then lets what it starts settle */
  const emit = async (next: AuthSession | null): Promise<void> => {
    await act(async () => {
      source.emit(next);
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  /** reports `userId` gone to every listener, then lets what it starts settle */
  const reportGone = async (userId: string): Promise<void> => {
    await act(async () => {
      gone.report(userId);
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  /** rerenders with the persisted cache restore running or done, then lets what it starts settle */
  const setRestoring = async (next: boolean): Promise<void> => {
    await act(async () => {
      current.restoring = next;
      rendered.rerender();
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  /** whether the device-wide steps left everything in place */
  const deviceWideUntouched = (): boolean =>
    guest.clear.mock.calls.length === 0 &&
    recentSearches.stored().length === 1 &&
    queryClient.getQueryData(DRIVER_PROBE_QUERY_KEY) === 1 &&
    removePersistedCache.mock.calls.length === 0 &&
    rendered.result.current === 0;

  return {
    ...rendered,
    auth,
    gone,
    markers,
    guest,
    recentSearches,
    removePersistedCache,
    captureError,
    queryClient,
    accountRepositoryFor,
    factoryCalls,
    accountsOf,
    emit,
    reportGone,
    setRestoring,
    deviceWideUntouched,
  };
};

export type RenderedDevicePurgeDriver = Awaited<ReturnType<typeof renderDevicePurgeDriver>>;

/** lets the pending calls settle */
export const settleDriver = async (): Promise<void> => {
  await flushSessionReports();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};
