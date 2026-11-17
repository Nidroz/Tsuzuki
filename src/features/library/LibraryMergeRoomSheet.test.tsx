import type { LibraryEntry } from '@core/domain/library-entry';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN } from './__fixtures__/library-entries';
import { LibraryMergeRoomSheet } from './LibraryMergeRoomSheet';

const TEST_ID = 'room-sheet';

const renderSheet = async (entry: LibraryEntry | null = FRIEREN) => {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  await renderWithProviders(
    <LibraryMergeRoomSheet
      entry={entry}
      onConfirm={onConfirm}
      onClose={onClose}
      testID={TEST_ID}
    />,
  );
  return { onConfirm, onClose, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

describe('LibraryMergeRoomSheet (R-09)', () => {
  it('asks before removing the title from the account, saying a device copy comes back', async () => {
    await renderSheet();

    expect(screen.getByRole('header', { name: 'Remove from your account?' })).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Sousou no Frieren will be removed from your account, with its status, progress, score and notes. If it is also saved on this device, that copy is added to your account with the others.',
      ),
    ).toBeOnTheScreen();
    expect(button('Close without removing')).toBeOnTheScreen();
    expect(button('Cancel')).toBeOnTheScreen();
    expect(button('Remove')).toHaveProp('className', expect.stringContaining('bg-danger'));
  });

  it('confirms on Remove', async () => {
    const { onConfirm, onClose, user } = await renderSheet();

    await user.press(button('Remove'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['Cancel', 'Close without removing'])('only closes on %s', async (name) => {
    const { onConfirm, onClose, user } = await renderSheet();

    await user.press(button(name));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing without an entry', async () => {
    await renderSheet(null);

    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeOnTheScreen();
  });
});
