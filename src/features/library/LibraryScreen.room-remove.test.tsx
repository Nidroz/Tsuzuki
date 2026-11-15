import { LibraryRemoteError } from '@core/errors/library-errors';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, screen, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { holdNextCall } from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderMergeRoomScreen, settle } from '../../../test/mobile/render-library-screen';
import { BERSERK, FRIEREN } from './__fixtures__/library-entries';
import { removeLabelOf, ROOM_ENTRIES } from './__fixtures__/merge-room';

// per R-09: a removal from the full account library asks first, then removes the title from the
// account and tries the merge again; the only write while the library stays pending (ADR-0016)

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const SHEET_TITLE = 'Remove from your account?';
const SHEET_MESSAGE =
  'Sousou no Frieren will be removed from your account, with its status, progress, score and notes. If it is also saved on this device, that copy is added to your account with the others.';
const OFFLINE = 'You are offline. Connect to the internet, then remove the title again.';
const FAILED = 'The title could not be removed from your account. Try again.';

afterEach(() => {
  // the onlineManager is one module instance for the whole file
  onlineManager.setOnline(true);
});

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

const removeButton = (title: string) => screen.getByRole('button', { name: removeLabelOf(title) });
const sheet = () => screen.getByTestId('library-merge-room-sheet');

// the room shown with its titles read, then the confirmation of Frieren's removal open
const openConfirmation = async (setup?: Parameters<typeof renderMergeRoomScreen>[0]) => {
  const rendered = await renderMergeRoomScreen(setup);
  await settle();
  await rendered.user.press(
    screen.getByTestId(
      `library-merge-room-entry-mal-anime-${String(FRIEREN.key.externalId)}-remove`,
    ),
  );
  return rendered;
};

const expectSheetClosed = (): void => {
  expect(screen.queryByTestId('library-merge-room-sheet')).not.toBeOnTheScreen();
};

describe('LibraryScreen: a removal to make room (R-09)', () => {
  it('asks first, naming the title, with a destructive confirm, and Cancel removes nothing', async () => {
    const { account, merge, user } = await openConfirmation();

    expect(sheet()).toHaveProp('visible', true);
    expect(within(sheet()).getByText(SHEET_TITLE)).toBeOnTheScreen();
    expect(within(sheet()).getByText(SHEET_MESSAGE)).toBeOnTheScreen();
    expect(
      within(sheet()).getByRole('button', { name: 'Close without removing' }),
    ).toBeOnTheScreen();
    const confirm = screen.getByTestId('library-merge-room-sheet-confirm');
    expect(confirm).toHaveAccessibleName('Remove');
    expect(confirm).toHaveProp('className', expect.stringContaining('bg-danger'));

    await user.press(screen.getByTestId('library-merge-room-sheet-cancel'));

    expectSheetClosed();
    expect(account.remove).not.toHaveBeenCalled();
    expect(merge.retry).not.toHaveBeenCalled();
  });

  it('removes the confirmed title from the account, then tries the merge again', async () => {
    const { account, merge, user } = await openConfirmation();

    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));
    await settle();

    expectSheetClosed();
    expect(account.remove.mock.calls).toStrictEqual([[FRIEREN.key]]);
    expect(account.stored(FRIEREN.key)).toBeNull();
    expect(account.save).not.toHaveBeenCalled();
    expect(merge.retry).toHaveBeenCalledTimes(1);
    // until the merge restarts, no other removal and no Try again
    expect(removeButton(BERSERK.media.title)).toBeDisabled();
    expect(screen.getByTestId('library-merge-room-retry')).toBeDisabled();
  });

  it('shows the removal running on its row, every Remove disabled meanwhile', async () => {
    const account = createStuckAccount(0, ROOM_ENTRIES).account;
    const held = holdNextCall(account, 'remove');
    const { merge, user } = await openConfirmation({ account });

    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));

    expect(
      screen.getByRole('button', { name: 'Removing Sousou no Frieren from your account' }),
    ).toHaveProp('accessibilityState', expect.objectContaining({ busy: true }));
    expect(removeButton(BERSERK.media.title)).toBeDisabled();
    expect(merge.retry).not.toHaveBeenCalled();

    await act(async () => {
      held.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('writes nothing offline and says so, announced, each time anew', async () => {
    const { account, merge, user } = await openConfirmation();
    onlineManager.setOnline(false);
    const announce = spyOnAnnounce();

    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));

    const feedback = screen.getByTestId('library-merge-room-feedback');
    expect(feedback).toHaveProp('accessibilityRole', 'alert');
    expect(feedback).toHaveTextContent(OFFLINE);
    expect(announce.mock.calls).toStrictEqual([[OFFLINE]]);
    expect(account.remove).not.toHaveBeenCalled();
    expect(merge.retry).not.toHaveBeenCalled();
    // the row stays, its Remove enabled
    expect(removeButton(FRIEREN.media.title)).toBeEnabled();

    await user.press(removeButton(FRIEREN.media.title));
    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));

    expect(announce.mock.calls).toStrictEqual([[OFFLINE], [OFFLINE]]);
  });

  it('says a refused removal failed, announced, and keeps the title', async () => {
    const account = createStuckAccount(0, ROOM_ENTRIES).account;
    const { merge, user } = await openConfirmation({ account });
    account.beforeCall.mockRejectedValueOnce(new LibraryRemoteError('rejected'));
    const announce = spyOnAnnounce();

    await user.press(screen.getByTestId('library-merge-room-sheet-confirm'));
    await settle();

    expect(screen.getByTestId('library-merge-room-feedback')).toHaveTextContent(FAILED);
    expect(announce.mock.calls).toStrictEqual([[FAILED]]);
    expect(merge.retry).not.toHaveBeenCalled();
    expect(removeButton(FRIEREN.media.title)).toBeEnabled();
  });

  it('asks in french', async () => {
    await openConfirmation({ language: 'fr' });

    expect(within(sheet()).getByText('Retirer de votre compte ?')).toBeOnTheScreen();
    expect(
      within(sheet()).getByText(
        "Sousou no Frieren sera retiré de votre compte, avec son statut, sa progression, sa note et vos notes personnelles. S'il est aussi enregistré sur cet appareil, cette copie est ajoutée à votre compte avec les autres.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('library-merge-room-sheet-confirm')).toHaveAccessibleName('Retirer');
  });
});
