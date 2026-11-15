// the useGuestMergeRoom hook inside the catalog, device purge, session library and guest merge
// contexts the composition root gives, with a recording reporter, for the use-guest-merge-room
// tests. the test drives the merge value and the session account between renders
import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';

import { createFakeGuestLibraryRepository } from './fake-library-repository';
import { entryWithMedia, keyOf } from './library-entry-fixtures';
import { createRecordingReporter, TestReporterContext } from './library-hooks-support';
import { USER_A } from './session-library-support';
import { createStuckAccount, type FakeOfflineAccount } from './stuck-account';
import {
  createFakeCatalogProvider,
  FAKE_IMAGE_HOSTS,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { GuestMergeContext, type GuestMergeValue } from '@core/hooks/guest-merge-context';
import {
  SessionLibraryContext,
  type SessionLibraryValue,
} from '@core/hooks/session-library-context';
import { useGuestMergeRoom } from '@core/hooks/use-guest-merge-room';
import type { OfflineAccountLibraryRepository } from '@core/repositories/offline-account-library-repository';

/** a cover on the fake provider's host: kept */
export const ALLOWED_COVER = `https://${FAKE_IMAGE_HOSTS[0] ?? ''}/images/anime/1.jpg`;

/** three account entries, most recently updated first: a clean one, an adult one, a manga */
export const CLEAN = entryWithMedia(
  { title: 'Mushishi', imageUrl: ALLOWED_COVER },
  { key: keyOf('anime', 457), updatedAt: '2026-03-03T00:00:00.000Z' },
);
export const ADULT = entryWithMedia(
  { title: 'Adult title', imageUrl: ALLOWED_COVER, isAdult: true },
  { key: keyOf('anime', 900), updatedAt: '2026-03-02T00:00:00.000Z' },
);
// its cover is on a host the fake provider does not serve: shown without it
export const MANGA = entryWithMedia(
  { title: 'Monster' },
  { key: keyOf('manga', 1), updatedAt: '2026-03-01T00:00:00.000Z' },
);
export const ACCOUNT_ENTRIES: readonly LibraryEntry[] = [CLEAN, ADULT, MANGA];

/** a new merge value refused at the cap, as the provider gives after each refused run */
export const fullMergeOf = (retry = jest.fn<() => void>()): GuestMergeValue => ({
  status: 'failed',
  failure: 'library-full',
  retry,
});

const noFactory = (): OfflineAccountLibraryRepository => {
  throw new Error('unexpected call to the account library factory');
};

interface RoomState {
  merge: GuestMergeValue;
  account: OfflineAccountLibraryRepository | null;
}

export interface RoomSetup {
  readonly merge?: GuestMergeValue;
  /** the session's account instance; a fake holding ACCOUNT_ENTRIES by default, null signed out */
  readonly account?: FakeOfflineAccount | null;
  readonly showAdult?: boolean;
}

/**
 * renders useGuestMergeRoom with `merge` (refused at the cap by default) and the session account;
 * `setMerge(next)` and `setAccount(next)` rerender it with a new value
 */
export const renderRoom = ({
  merge = fullMergeOf(),
  account = createStuckAccount(0, ACCOUNT_ENTRIES).account,
  showAdult = false,
}: RoomSetup = {}) => {
  const { reporter, captureError } = createRecordingReporter();
  const provider = createFakeCatalogProvider();
  const guest = createFakeGuestLibraryRepository();
  const state: RoomState = { merge, account };

  function Contexts({ children }: { readonly children: ReactNode }) {
    const { account: current } = state;
    const session = useMemo(
      (): SessionLibraryValue => ({
        account: current,
        userId: current === null ? null : USER_A,
        guest,
        accountRepositoryFor: noFactory,
      }),
      [current],
    );
    return (
      <CatalogContextProvider provider={provider}>
        <TestReporterContext reporter={reporter}>
          <SessionLibraryContext value={session}>
            <GuestMergeContext value={state.merge}>{children}</GuestMergeContext>
          </SessionLibraryContext>
        </TestReporterContext>
      </CatalogContextProvider>
    );
  }

  const rendered = renderHook(() => useGuestMergeRoom({ showAdult }), { wrapper: Contexts });
  const setMerge = (next: GuestMergeValue): void => {
    state.merge = next;
    rendered.rerender();
  };
  const setAccount = (next: OfflineAccountLibraryRepository | null): void => {
    state.account = next;
    rendered.rerender();
  };
  return { ...rendered, account, captureError, setMerge, setAccount };
};

/** lets the pending repository calls settle */
export const settle = async (): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};
