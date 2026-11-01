import type { GuestMergeStatus, GuestMergeValue } from '@core/hooks/guest-merge-context';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderLibraryScreen, settle } from '../../../test/mobile/render-library-screen';

// adR-0016 "What the user sees": the library screen while the guest library is merged into the
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

const mergeOf = (status: GuestMergeStatus) => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status, retry };
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
});
