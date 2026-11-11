import { LIBRARY_ENTRIES_PER_USER_MAX } from '@core/domain/database-limits';
import type { GuestMergeStatus, GuestMergeValue } from '@core/hooks/guest-merge-context';
import { formatNumber } from '@core/i18n/index';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderLibraryScreen, settle } from '../../../test/mobile/render-library-screen';

// see ADR-0016 "What the user sees": the library screen while the guest library is merged into the
// account, and after a failed merge: the library stays pending until a retry succeeded, so the
// failure replaces the whole list

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const MERGING_TEXT = 'Adding the titles saved on this device to your account…';
const FAILED_TITLE = 'Your library is not ready yet';
const FAILED_TEXT =
  'The titles saved on this device could not be added to your account. They stay on this device: try again to add them and open your library.';

const FULL_TEXT =
  'The titles saved on this device could not be added to your account: its library is full, with 10,000 titles. They stay on this device. Remove titles from your library on another device, then try again, or sign out to use them here.';

const mergeOf = (status: GuestMergeStatus) => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status, retry };
  return { guestMerge, retry };
};

// a merge the account refused at its cap (R-04)
const fullMerge = () => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status: 'failed', failure: 'library-full', retry };
  return { guestMerge, retry };
};

describe('LibraryScreen guest merge (A-04)', () => {
  it('says the titles of the device are being added, announced once by the spinner, instead of the list', async () => {
    await renderLibraryScreen({ guestMerge: mergeOf('merging').guestMerge });
    await settle();

    const spinner = screen.getByRole('progressbar', { name: MERGING_TEXT });
    expect(spinner).toHaveProp('testID', 'library-merging');
    // the visible caption is hidden from screen readers: the sentence is read once
    expect(screen.getByText(MERGING_TEXT, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(MERGING_TEXT)).not.toBeOnTheScreen();
    expect(screen.getAllByLabelText(MERGING_TEXT)).toStrictEqual([spinner]);
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-loading')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
  });

  it('shows a failed merge instead of the library, announced, with a retry', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const { guestMerge, retry } = mergeOf('failed');
    const { user } = await renderLibraryScreen({ guestMerge });
    await settle();

    const failure = screen.getByTestId('library-merge-error');
    expect(failure).toHaveProp('accessibilityRole', 'alert');
    expect(within(failure).getByText(FAILED_TITLE)).toBeOnTheScreen();
    expect(within(failure).getByText(FAILED_TEXT)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(`${FAILED_TITLE}\n${FAILED_TEXT}`);
    // no list under it, even though the repository could be read
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    expect(screen.queryByText('Sousou no Frieren')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-empty')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-loading')).not.toBeOnTheScreen();

    await user.press(within(failure).getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('tells a merge refused by a full account library, announced, with a retry (R-04)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const { guestMerge, retry } = fullMerge();
    const { user } = await renderLibraryScreen({ guestMerge });
    await settle();

    const failure = screen.getByTestId('library-merge-error');
    expect(within(failure).getByText(FAILED_TITLE)).toBeOnTheScreen();
    expect(within(failure).getByText(FULL_TEXT)).toBeOnTheScreen();
    expect(within(failure).queryByText(FAILED_TEXT)).not.toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(`${FAILED_TITLE}\n${FULL_TEXT}`);
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();

    await user.press(within(failure).getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the generic text for a merge that failed otherwise', async () => {
    const guestMerge: GuestMergeValue = { status: 'failed', failure: 'other', retry: jest.fn() };
    await renderLibraryScreen({ guestMerge });
    await settle();

    expect(
      within(screen.getByTestId('library-merge-error')).getByText(FAILED_TEXT),
    ).toBeOnTheScreen();
  });

  it.each<GuestMergeStatus>(['idle', 'checking'])(
    'shows nothing of the merge while %s',
    async (status) => {
      await renderLibraryScreen({ guestMerge: mergeOf(status).guestMerge });
      await settle();

      expect(screen.getByTestId('library-list')).toBeOnTheScreen();
      expect(screen.queryByTestId('library-merging')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    },
  );

  it('shows the merge texts in french', async () => {
    await renderLibraryScreen({ guestMerge: mergeOf('failed').guestMerge, language: 'fr' });
    await settle();

    const failure = screen.getByTestId('library-merge-error');
    expect(
      within(failure).getByText("Votre bibliothèque n'est pas encore prête"),
    ).toBeOnTheScreen();
    expect(
      within(failure).getByText(
        "Les titres enregistrés sur cet appareil n'ont pas pu être ajoutés à votre compte. Ils restent sur cet appareil : réessayez pour les ajouter et ouvrir votre bibliothèque.",
      ),
    ).toBeOnTheScreen();
    expect(within(failure).getByRole('button', { name: 'Réessayer' })).toBeOnTheScreen();
  });

  it('tells a full account library in french', async () => {
    await renderLibraryScreen({ guestMerge: fullMerge().guestMerge, language: 'fr' });
    await settle();

    const max = formatNumber(LIBRARY_ENTRIES_PER_USER_MAX, 'fr');
    expect(
      within(screen.getByTestId('library-merge-error')).getByText(
        `Les titres enregistrés sur cet appareil n'ont pas pu être ajoutés à votre compte : sa bibliothèque est pleine, avec ${max} titres. Ils restent sur cet appareil. Retirez des titres de votre bibliothèque sur un autre appareil, puis réessayez, ou déconnectez-vous pour les utiliser ici.`,
      ),
    ).toBeOnTheScreen();
  });
});
