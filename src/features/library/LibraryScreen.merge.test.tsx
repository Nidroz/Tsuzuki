import type { GuestMergeStatus, GuestMergeValue } from '@core/hooks/guest-merge-context';
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderLibraryScreen, settle } from '../../../test/mobile/render-library-screen';

// adR-0016 "What the user sees": the library screen while the guest library is merged into the
// account, and after a failed merge

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
const FAILED_TEXT =
  'Some titles saved on this device could not be added to your account. They stay on this device until they are.';

const mergeOf = (status: GuestMergeStatus) => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status, retry };
  return { guestMerge, retry };
};

describe('LibraryScreen guest merge (A-04)', () => {
  it('says the titles of the device are being added, with a labelled spinner instead of the list', async () => {
    await renderLibraryScreen({ guestMerge: mergeOf('merging').guestMerge });
    await settle();

    expect(screen.getByLabelText(MERGING_TEXT)).toHaveProp('testID', 'library-merging');
    expect(screen.getByText(MERGING_TEXT)).toBeOnTheScreen();
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-loading')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
  });

  it('shows a failed merge above the list, with a retry', async () => {
    const { guestMerge, retry } = mergeOf('failed');
    const { user } = await renderLibraryScreen({ guestMerge });
    await settle();

    const banner = screen.getByTestId('library-merge-error');
    expect(banner).toHaveProp('accessibilityRole', 'alert');
    expect(banner).toHaveTextContent(FAILED_TEXT, { exact: false });
    expect(screen.getByTestId('library-list')).toBeOnTheScreen();
    expect(screen.getByText('Sousou no Frieren')).toBeOnTheScreen();

    await user.press(screen.getByTestId('library-merge-error-action'));

    expect(screen.getByTestId('library-merge-error-action')).toHaveAccessibleName('Try again');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the failed merge above the empty state', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository(),
      guestMerge: mergeOf('failed').guestMerge,
    });
    await settle();

    expect(screen.getByTestId('library-merge-error')).toBeOnTheScreen();
    expect(screen.getByTestId('library-empty')).toBeOnTheScreen();
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

    expect(
      screen.getByText(
        "Certains titres enregistrés sur cet appareil n'ont pas pu être ajoutés à votre compte. Ils restent sur cet appareil en attendant.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('library-merge-error-action')).toHaveAccessibleName('Réessayer');
  });
});
