// renders the sign out and account deletion hooks (src/core/hooks/) inside every context they read,
// with fixed values a test drives: the auth, the session libraries, the guest merge status, the
// live library writer, the recent searches and the real DevicePurgeContextProvider. the calls of
// every fake are read back in order with `sequence()`
import { jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createSessionAuthRepository } from './fake-auth-repository';
import { createFakeGuestLibraryRepository } from './fake-library-repository';
import { createFakeRecentSearchesRepository } from './fake-recent-searches-repository';
import { createSessionAccount, type FakeSessionAccount } from './session-library-support';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { DevicePurgeContextProvider } from '@core/hooks/DevicePurgeContextProvider';
import { GuestMergeContext, type GuestMergeStatus } from '@core/hooks/guest-merge-context';
import { LibraryContext } from '@core/hooks/library-context';
import type { LibraryWriter } from '@core/hooks/library-writer';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import { SessionLibraryContext } from '@core/hooks/session-library-context';
import { usePurgeGeneration } from '@core/hooks/use-device-purge';
import { toLibraryScope } from '@core/query/keys';
import { createQueryClient } from '@core/query/query-client';
import { noCaptcha, type AuthRepository } from '@core/repositories/auth-repository';

/** a query of the cache before the purge */
export const PROBE_QUERY_KEY = ['probe'] as const;

/** a recent search stored before the purge */
export const STORED_SEARCH = 'frieren';

const SCOPE = toLibraryScope(1);

const rejectUnexpected = (): Promise<never> =>
  Promise.reject(new Error('unexpected call to the fake library writer'));

/**
 * a library writer whose flushAll resolves and whose pendingChangeCount is 0 (jest mocks a test sets
 * up); its other calls reject
 */
export const createFakeWriter = () =>
  ({
    read: jest.fn<LibraryWriter['read']>(rejectUnexpected),
    list: jest.fn<LibraryWriter['list']>(rejectUnexpected),
    apply: jest.fn<LibraryWriter['apply']>(rejectUnexpected),
    flushAll: jest.fn<LibraryWriter['flushAll']>(() => Promise.resolve()),
    pendingChangeCount: jest.fn<LibraryWriter['pendingChangeCount']>(() => 0),
  }) satisfies LibraryWriter;

export interface SessionEndSetup {
  /** the session's account instance (createSessionAccount by default); null: no session */
  readonly account?: FakeSessionAccount | null;
  /** the guest merge status at first, `idle` by default */
  readonly mergeStatus?: GuestMergeStatus;
  /** the auth repository calls the test expects (signOut, deleteAccount) */
  readonly auth?: Partial<AuthRepository>;
}

const ignoreRetry = (): void => undefined;

/**
 * renders `useHook` (as `result.current.hook`) and usePurgeGeneration (`result.current.generation`)
 * inside the contexts of the composition root, with a query in the cache (PROBE_QUERY_KEY) and a
 * stored recent search (STORED_SEARCH). `setMergeStatus(next)` rerenders under another merge status
 */
export const renderSessionEndHook = <T,>(
  useHook: () => T,
  {
    account = createSessionAccount(),
    mergeStatus = 'idle',
    auth: overrides = {},
  }: SessionEndSetup = {},
) => {
  const auth = createSessionAuthRepository(null, overrides);
  const guest = createFakeGuestLibraryRepository();
  const recentSearches = createFakeRecentSearchesRepository([STORED_SEARCH]);
  const writer = createFakeWriter();
  const removePersistedCache = jest.fn<() => void>();
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const reporter: ErrorReporter = { captureError };
  const queryClient = createQueryClient();
  queryClient.setQueryData(PROBE_QUERY_KEY, 1);
  const sessionLibrary = { account, guest };
  const library = { repository: account ?? guest, writer, scope: SCOPE };
  // the guest merge value, replaced by setMergeStatus
  const current = { merge: { status: mergeStatus, retry: ignoreRetry } };

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={auth} captcha={noCaptcha}>
        <RecentSearchesContextProvider repository={recentSearches}>
          <SessionLibraryContext value={sessionLibrary}>
            <GuestMergeContext value={current.merge}>
              <LibraryContext value={library}>
                <DevicePurgeContextProvider
                  removePersistedCache={removePersistedCache}
                  reporter={reporter}
                >
                  {children}
                </DevicePurgeContextProvider>
              </LibraryContext>
            </GuestMergeContext>
          </SessionLibraryContext>
        </RecentSearchesContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(() => ({ hook: useHook(), generation: usePurgeGeneration() }), {
    wrapper,
  });

  const setMergeStatus = (next: GuestMergeStatus): void => {
    act(() => {
      current.merge = { status: next, retry: ignoreRetry };
      rendered.rerender();
    });
  };

  // every fake call a test orders, by name
  const named: Record<string, { readonly mock: { readonly invocationCallOrder: number[] } }> = {
    flush: writer.flushAll,
    signOut: auth.signOut,
    deleteAccount: auth.deleteAccount,
    clearGuest: guest.clear,
    clearRecentSearches: recentSearches.clear,
    removePersistedCache,
    ...(account !== null && {
      replay: account.replayQueuedWrites,
      count: account.queuedWriteCount,
      purgeAccount: account.purgeDeviceData,
    }),
  };
  /** the names of the fake calls made so far, in call order */
  const sequence = (): readonly string[] =>
    Object.entries(named)
      .flatMap(([name, { mock }]) => mock.invocationCallOrder.map((order) => ({ name, order })))
      .sort((left, right) => left.order - right.order)
      .map(({ name }) => name);

  return {
    ...rendered,
    account,
    auth,
    guest,
    recentSearches,
    writer,
    removePersistedCache,
    captureError,
    queryClient,
    setMergeStatus,
    sequence,
  };
};
