// the useLibrarySyncIssues hook (src/core/hooks/) inside the session, library and device purge
// contexts the composition root gives, with a query client whose invalidations are recorded and a
// recording reporter
import { jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeDevicePurgeMarkers } from './fake-device-purge-markers';
import { createFakeGuestLibraryRepository } from './fake-library-repository';
import { createFakeWriter } from './session-end-hooks-support';
import { USER_A } from './session-library-support';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { DevicePurgeContext, type DevicePurgeValue } from '@core/hooks/device-purge-context';
import { guardDevicePurgeMarkers } from '@core/hooks/device-purge-markers';
import { LibraryContext } from '@core/hooks/library-context';
import {
  SessionLibraryContext,
  type SessionLibraryValue,
} from '@core/hooks/session-library-context';
import { useLibrarySyncIssues } from '@core/hooks/use-library-sync-issues';
import { queryKeys, toLibraryScope } from '@core/query/keys';
import { createQueryClient } from '@core/query/query-client';
import type { LibraryRepository } from '@core/repositories/library-repository';
import type { OfflineAccountLibraryRepository } from '@core/repositories/offline-account-library-repository';

const SCOPE = toLibraryScope(7);

/** the list key of the live library scope: invalidating it, non-exact, refetches the library */
export const LIBRARY_KEY = queryKeys.library.all(SCOPE);

const noFactory = (): OfflineAccountLibraryRepository => {
  throw new Error('unexpected call to the account library factory');
};

export interface SyncIssuesSetup {
  /** the session's account instance, null signed out */
  readonly account: OfflineAccountLibraryRepository | null;
  /** the live library; the account, else the guest library, by default */
  readonly live?: LibraryRepository;
}

// the session and library values: `account` as the session account, `live` as the live library
const sessionValuesOf = (
  account: OfflineAccountLibraryRepository | null,
  guest: SessionLibraryValue['guest'],
  live?: LibraryRepository,
) => ({
  sessionLibrary: {
    account,
    userId: account === null ? null : USER_A,
    guest,
    accountRepositoryFor: noFactory,
  } satisfies SessionLibraryValue,
  library: { repository: live ?? account ?? guest, writer: createFakeWriter(), scope: SCOPE },
});

// the hook inside session, library and device purge contexts, as the composition root gives;
// `switchTo(next)` rerenders it with `next` as the session's account, live (another user)
export const renderSyncIssues = ({ account, live }: SyncIssuesSetup) => {
  const queryClient = createQueryClient();
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const reporter: ErrorReporter = { captureError };
  const guest = createFakeGuestLibraryRepository();
  let current = sessionValuesOf(account, guest, live);
  const purge: DevicePurgeValue = {
    removePersistedCache: jest.fn<() => void>(),
    reporter,
    markers: guardDevicePurgeMarkers(createFakeDevicePurgeMarkers(), reporter),
    generation: 0,
    advanceGeneration: jest.fn<() => void>(),
  };
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionLibraryContext value={current.sessionLibrary}>
        <LibraryContext value={current.library}>
          <DevicePurgeContext value={purge}>{children}</DevicePurgeContext>
        </LibraryContext>
      </SessionLibraryContext>
    </QueryClientProvider>
  );
  const rendered = renderHook(useLibrarySyncIssues, { wrapper });
  const switchTo = (next: OfflineAccountLibraryRepository): void => {
    act(() => {
      current = sessionValuesOf(next, guest);
      rendered.rerender();
    });
  };
  return { ...rendered, invalidate, captureError, switchTo };
};

/** lets the pending calls settle */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};
