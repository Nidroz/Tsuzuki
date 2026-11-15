import { LIBRARY_ENTRIES_PER_USER_MAX } from '@core/domain/database-limits';
import { LibraryRemoteError } from '@core/errors/library-errors';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { PENDING_LIBRARY_REPOSITORY } from '@core/hooks/SessionLibraryContextProvider';
import { formatNumber } from '@core/i18n/index';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  createFakeGuestLibraryRepository,
  holdNextCall,
} from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import {
  renderMergeRoomScreen as renderRoomScreen,
  settle,
} from '../../../test/mobile/render-library-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FavoritesScreen } from '../favorites/FavoritesScreen';
import { ADULT, BERSERK, FRIEREN } from './__fixtures__/library-entries';
import { fullMergeOf, removeLabelOf, ROOM_ENTRIES, ROOM_NOTICE } from './__fixtures__/merge-room';
import { LibraryScreen } from './LibraryScreen';

// per R-09: the library tab while the guest merge is refused because the account library is full: the
// account's titles with Remove only, the library itself still pending (ADR-0016)

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

const rowOf = (externalId: number, kind = 'anime') =>
  screen.getByTestId(`library-merge-room-entry-mal-${kind}-${String(externalId)}`);

describe('LibraryScreen with a guest merge refused at the cap (R-09)', () => {
  it('shows an announced notice with Try again, then the account titles with Remove only', async () => {
    const announce = spyOnAnnounce();
    const { merge, user } = await renderRoomScreen();
    await settle();

    const room = screen.getByTestId('library-merge-room');
    expect(within(screen.getByTestId('library-screen')).getByTestId('library-merge-room')).toBe(
      room,
    );
    const notice = screen.getByTestId('library-merge-room-notice');
    expect(within(notice).getByRole('alert', { name: ROOM_NOTICE })).toBeOnTheScreen();
    expect(announce.mock.calls).toStrictEqual([[ROOM_NOTICE]]);
    // the rows: the title and its lines, no button of their own
    expect(rowOf(FRIEREN.key.externalId)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 12 / 28 episodes, My score 9 / 10',
    );
    expect(rowOf(FRIEREN.key.externalId)).not.toHaveProp('accessibilityRole');
    expect(rowOf(BERSERK.key.externalId, 'manga')).toHaveAccessibleName(
      'Berserk, Manga, 364 chapters',
    );
    // remove is the only action of a row: no `+1`, no heart, no detail
    expect(screen.getAllByRole('button')).toStrictEqual([
      within(notice).getByRole('button', { name: 'Try again' }),
      screen.getByRole('button', { name: removeLabelOf('Sousou no Frieren') }),
      screen.getByRole('button', { name: removeLabelOf('Berserk') }),
    ]);
    expect(screen.getByRole('button', { name: removeLabelOf('Berserk') })).toHaveTextContent(
      'Remove',
    );
    // still the pending library: neither its rows nor the merge error
    expect(screen.queryByTestId('library-list')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-error')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('library-entry-mal-anime-52991')).not.toBeOnTheScreen();

    await user.press(within(notice).getByRole('button', { name: 'Try again' }));

    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('hides the adult titles while the setting is off and says how many (BR-06)', async () => {
    await renderRoomScreen({ account: createStuckAccount(0, [...ROOM_ENTRIES, ADULT]).account });
    await settle();

    expect(screen.getByTestId('library-merge-room-list-hidden-note')).toHaveTextContent(
      '1 adult title is hidden.',
    );
    expect(screen.queryByText('Adult title')).not.toBeOnTheScreen();
  });

  it('shows a spinner while the titles are read', async () => {
    const account = createStuckAccount(0, ROOM_ENTRIES).account;
    holdNextCall(account, 'list');
    await renderRoomScreen({ account });
    await settle();

    expect(
      screen.getByRole('progressbar', { name: 'Loading the titles of your account' }),
    ).toHaveProp('testID', 'library-merge-room-loading');
    expect(screen.getByTestId('library-merge-room-notice')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-room-list')).not.toBeOnTheScreen();
  });

  it('shows a failed read with a retry that reads again', async () => {
    const account = createStuckAccount(0, ROOM_ENTRIES).account;
    account.beforeCall.mockRejectedValueOnce(new LibraryRemoteError('network'));
    const { user } = await renderRoomScreen({ account });
    await settle();

    const failure = screen.getByTestId('library-merge-room-error');
    expect(failure).toHaveProp('accessibilityRole', 'alert');
    expect(
      within(failure).getByText('The titles of your account could not be loaded'),
    ).toBeOnTheScreen();
    expect(within(failure).getByText('Try again in a moment.')).toBeOnTheScreen();

    await user.press(within(failure).getByRole('button', { name: 'Try again' }));
    await settle();

    expect(account.list).toHaveBeenCalledTimes(2);
    expect(rowOf(FRIEREN.key.externalId)).toBeOnTheScreen();
  });

  it('says there is nothing to remove for an empty account library, with Try again', async () => {
    const { merge, user } = await renderRoomScreen({ account: createStuckAccount(0).account });
    await settle();

    const empty = screen.getByTestId('library-merge-room-empty');
    expect(within(empty).getByText('No titles to remove')).toBeOnTheScreen();
    expect(
      within(empty).getByText(
        "Your account's library holds no titles now. Try again to add the titles saved on this device.",
      ),
    ).toBeOnTheScreen();

    await user.press(within(empty).getByRole('button', { name: 'Try again' }));

    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('shows the merge error for any other failure', async () => {
    await renderRoomScreen({ merge: { status: 'failed', failure: 'other', retry: jest.fn() } });
    await settle();

    expect(screen.getByTestId('library-merge-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-merge-room')).not.toBeOnTheScreen();
  });

  it('shows the room in french', async () => {
    await renderRoomScreen({ language: 'fr' });
    await settle();

    expect(
      within(screen.getByTestId('library-merge-room-notice')).getByText(
        `La bibliothèque de votre compte est pleine, avec ${formatNumber(LIBRARY_ENTRIES_PER_USER_MAX, 'fr')} titres : les titres enregistrés sur cet appareil n'ont donc pas pu y être ajoutés. Ils restent sur cet appareil. Retirez ici des titres de votre compte pour faire de la place : après chaque retrait, ils sont ajoutés s'il y a assez de place.`,
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Retirer Sousou no Frieren de votre compte' }),
    ).toHaveTextContent('Retirer');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeOnTheScreen();
  });

  it('announces the refusal once with the favorites tab, which keeps its error', async () => {
    const announce = spyOnAnnounce();
    await renderWithProviders(
      <LibraryContextProvider repository={PENDING_LIBRARY_REPOSITORY}>
        <LibraryScreen />
        <FavoritesScreen />
      </LibraryContextProvider>,
      {
        guestMerge: fullMergeOf(),
        sessionLibrary: {
          account: createStuckAccount(0, ROOM_ENTRIES).account,
          guest: createFakeGuestLibraryRepository(),
        },
      },
    );
    await settle();

    expect(screen.getByTestId('library-merge-room')).toBeOnTheScreen();
    expect(screen.getByTestId('favorites-merge-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('favorites-merge-room')).not.toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
