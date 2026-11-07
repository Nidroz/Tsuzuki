import type { ErrorReporter } from '@core/errors/error-reporter';
import { GuestMergeContext, type GuestMergeValue } from '@core/hooks/guest-merge-context';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { PENDING_LIBRARY_REPOSITORY } from '@core/hooks/SessionLibraryContextProvider';
import type { LibraryReplayRun } from '@core/repositories/offline-account-library-repository';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  createDeferred,
  createFakeGuestLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { createStuckAccount, type StuckAccount } from '../../../test/core/stuck-account';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN_DETAIL } from '../media-detail/__fixtures__/media-details';
import { LibrarySection } from '../media-detail/LibrarySection';
import { LibraryEntriesScreen, type LibraryEntriesEmptyTexts } from './LibraryEntriesScreen';
import { LibrarySyncNotice } from './LibrarySyncNotice';

// per R-03: the library and favorites tabs stay mounted together and the detail opens above them,
// so a state they all show is announced once: a failed guest merge, the stuck writes notice, its
// count changes and the feedback of its actions

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screens: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const FAILED_TITLE = 'Your library is not ready yet';
const FAILED_TEXT =
  'The titles saved on this device could not be added to your account. They stay on this device: try again to add them and open your library.';
const OFFLINE_FEEDBACK = 'You are offline. Connect to the internet, then try again.';
const DISCARD_FAILED_FEEDBACK = 'The changes could not be discarded. Try again.';
const DISCARD_LABEL = 'Discard the changes that could not be synced';
const EMPTY: LibraryEntriesEmptyTexts = { title: 'Empty', message: 'Nothing here', action: 'Go' };

const noticeText = (count: number): string =>
  `${String(count)} changes could not be synced to your account.`;

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const FAILED_MERGE: GuestMergeValue = { status: 'failed', retry: jest.fn<() => void>() };
// the merge of the tests that step it through a retry: failed, then merging again
const MERGE_IN: Readonly<Record<'failed' | 'merging', GuestMergeValue>> = {
  failed: FAILED_MERGE,
  merging: { status: 'merging', retry: FAILED_MERGE.retry },
};

// the library and favorites tabs, and the detail's library section when `withDetail`
function MergeViews({ withDetail }: { readonly withDetail: boolean }) {
  return (
    <LibraryContextProvider repository={PENDING_LIBRARY_REPOSITORY}>
      <LibraryEntriesScreen favoritesOnly={false} testID="library" empty={EMPTY} />
      <LibraryEntriesScreen favoritesOnly testID="favorites" empty={EMPTY} />
      {withDetail ? <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} /> : null}
    </LibraryContextProvider>
  );
}

// the tabs and the detail over a merge in `status`, nested: the test steps it through a retry
function MergeStatusViews({ status }: { readonly status: keyof typeof MERGE_IN }) {
  return (
    <GuestMergeContext value={MERGE_IN[status]}>
      <MergeViews withDetail />
    </GuestMergeContext>
  );
}

// the stuck writes notice of both tabs, over `stuck`'s account as the live library; a failed
// discard is reported, so the reporter records it
const renderBothNotices = async (stuck: StuckAccount) => {
  await renderWithProviders(
    <>
      <LibrarySyncNotice testID="library-sync" />
      <LibrarySyncNotice testID="favorites-sync" />
    </>,
    {
      sessionLibrary: { account: stuck.account, guest: createFakeGuestLibraryRepository() },
      reporter: { captureError: jest.fn<ErrorReporter['captureError']>() },
    },
  );
  return userEvent.setup();
};

describe('library announcements across the mounted views (R-03)', () => {
  it('announces a failed guest merge once for both tabs, and not again when the detail opens', async () => {
    const announce = spyOnAnnounce();
    const { rerender } = await renderWithProviders(<MergeViews withDetail={false} />, {
      guestMerge: FAILED_MERGE,
    });
    await settle();

    expect(screen.getByTestId('library-merge-error')).toBeOnTheScreen();
    expect(screen.getByTestId('favorites-merge-error')).toBeOnTheScreen();
    expect(announce.mock.calls).toStrictEqual([[`${FAILED_TITLE}\n${FAILED_TEXT}`]]);

    await rerender(<MergeViews withDetail />);
    await settle();

    expect(screen.getByTestId('media-detail-library-merge-error')).toHaveTextContent(FAILED_TEXT, {
      exact: false,
    });
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces a failed guest merge once when the tabs and the detail mount together', async () => {
    const announce = spyOnAnnounce();

    await renderWithProviders(<MergeViews withDetail />, { guestMerge: FAILED_MERGE });
    await settle();

    for (const testID of ['library', 'favorites', 'media-detail-library']) {
      expect(screen.getByTestId(`${testID}-merge-error`)).toHaveProp('accessibilityRole', 'alert');
    }
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces a failed guest merge once more when its retry fails again, after the spinners', async () => {
    const announce = spyOnAnnounce();
    const failedAnnouncement = `${FAILED_TITLE}\n${FAILED_TEXT}`;
    const { rerender } = await renderWithProviders(<MergeStatusViews status="failed" />);
    await settle();

    expect(announce.mock.calls).toStrictEqual([[failedAnnouncement]]);

    // the retry runs: every view swaps its error for a spinner, which announces nothing itself
    await rerender(<MergeStatusViews status="merging" />);
    await settle();

    expect(screen.getByTestId('library-merging')).toBeOnTheScreen();
    expect(screen.getByTestId('favorites-merging')).toBeOnTheScreen();
    expect(screen.getByTestId('media-detail-library-merging')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);

    // it failed again: a new outcome, announced once for the three views
    await rerender(<MergeStatusViews status="failed" />);
    await settle();

    for (const testID of ['library', 'favorites', 'media-detail-library']) {
      expect(screen.getByTestId(`${testID}-merge-error`)).toBeOnTheScreen();
    }
    expect(announce.mock.calls).toStrictEqual([[failedAnnouncement], [failedAnnouncement]]);
  });

  it('announces the stuck writes notice of both tabs once, then each count change and feedback once', async () => {
    const announce = spyOnAnnounce();
    const stuck = createStuckAccount(2);
    stuck.account.retryStuckWrites.mockResolvedValueOnce({ status: 'offline', confirmed: 0 });
    const user = await renderBothNotices(stuck);

    expect(screen.getAllByRole('alert', { name: noticeText(2) })).toHaveLength(2);
    expect(announce.mock.calls).toStrictEqual([[noticeText(2)]]);

    await act(() => {
      stuck.setStuckCount(3);
    });

    expect(announce.mock.calls).toStrictEqual([[noticeText(2)], [noticeText(3)]]);

    await user.press(
      within(screen.getByTestId('favorites-sync')).getByRole('button', { name: 'Try again' }),
    );
    await settle();

    expect(screen.getByTestId('library-sync-feedback')).toHaveTextContent(OFFLINE_FEEDBACK);
    expect(screen.getByTestId('favorites-sync-feedback')).toHaveTextContent(OFFLINE_FEEDBACK);
    expect(announce.mock.calls).toStrictEqual([
      [noticeText(2)],
      [noticeText(3)],
      [OFFLINE_FEEDBACK],
    ]);
  });

  it('announces a failed discard once for both tabs, and clears it in both when the other tab retries', async () => {
    const stuck = createStuckAccount(2);
    stuck.account.discardStuckWrites.mockImplementationOnce(() => {
      throw new Error('storage failed');
    });
    stuck.account.retryStuckWrites.mockReturnValueOnce(new Promise(() => undefined));
    const user = await renderBothNotices(stuck);
    const announce = spyOnAnnounce();

    await user.press(
      within(screen.getByTestId('library-sync')).getByRole('button', { name: DISCARD_LABEL }),
    );
    await user.press(screen.getByTestId('library-sync-discard-sheet-confirm'));

    for (const testID of ['library-sync-feedback', 'favorites-sync-feedback']) {
      expect(screen.getByTestId(testID)).toHaveProp('accessibilityRole', 'alert');
      expect(screen.getByTestId(testID)).toHaveTextContent(DISCARD_FAILED_FEEDBACK);
    }
    expect(announce.mock.calls).toStrictEqual([[DISCARD_FAILED_FEEDBACK]]);

    await user.press(
      within(screen.getByTestId('favorites-sync')).getByRole('button', { name: 'Try again' }),
    );

    expect(screen.queryByTestId('library-sync-feedback')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('favorites-sync-feedback')).not.toBeOnTheScreen();
    expect(
      within(screen.getByTestId('library-sync')).getByRole('button', { name: DISCARD_LABEL }),
    ).toBeDisabled();
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces each failure of two in a row once for both tabs: discards, then offline retries', async () => {
    const stuck = createStuckAccount(2);
    stuck.account.discardStuckWrites.mockImplementation(() => {
      throw new Error('storage failed');
    });
    stuck.account.retryStuckWrites.mockResolvedValue({ status: 'offline', confirmed: 0 });
    const user = await renderBothNotices(stuck);
    const announce = spyOnAnnounce();
    // a failed discard from each tab, in a row
    for (const tab of ['library-sync', 'favorites-sync']) {
      await user.press(
        within(screen.getByTestId(tab)).getByRole('button', { name: DISCARD_LABEL }),
      );
      await user.press(screen.getByTestId(`${tab}-discard-sheet-confirm`));
    }
    expect(announce.mock.calls).toStrictEqual([
      [DISCARD_FAILED_FEEDBACK],
      [DISCARD_FAILED_FEEDBACK],
    ]);

    announce.mockClear();
    for (const tab of ['favorites-sync', 'library-sync']) {
      await user.press(within(screen.getByTestId(tab)).getByRole('button', { name: 'Try again' }));
      await settle();
    }
    expect(screen.getByTestId('library-sync-feedback')).toHaveTextContent(OFFLINE_FEEDBACK);
    expect(screen.getByTestId('favorites-sync-feedback')).toHaveTextContent(OFFLINE_FEEDBACK);
    expect(announce.mock.calls).toStrictEqual([[OFFLINE_FEEDBACK], [OFFLINE_FEEDBACK]]);
  });

  it('shares the retry: one started on a tab disables Discard and starts no other on the other tab', async () => {
    const stuck = createStuckAccount(2);
    const run = createDeferred<LibraryReplayRun>();
    stuck.account.retryStuckWrites.mockReturnValueOnce(run.promise);
    const user = await renderBothNotices(stuck);
    const library = within(screen.getByTestId('library-sync'));
    const favorites = within(screen.getByTestId('favorites-sync'));

    await user.press(library.getByRole('button', { name: 'Try again' }));

    expect(favorites.getByRole('button', { name: DISCARD_LABEL })).toBeDisabled();
    const pending = favorites.getByRole('button', { name: 'Trying to sync your changes again' });
    expect(pending).toBeDisabled();
    await user.press(pending);
    expect(stuck.account.retryStuckWrites).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve({ status: 'failed', confirmed: 0 });
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(favorites.getByRole('button', { name: DISCARD_LABEL })).toBeEnabled();
    expect(library.getByRole('button', { name: DISCARD_LABEL })).toBeEnabled();
  });
});
