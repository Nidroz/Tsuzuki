import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { RemoveSheet } from './RemoveSheet';

const renderSheet = async (visible = true) => {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  await renderWithProviders(
    <RemoveSheet visible={visible} onConfirm={onConfirm} onClose={onClose} />,
  );
  return { onConfirm, onClose, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

describe('RemoveSheet', () => {
  it('asks before removing, telling that the score and notes go too', async () => {
    await renderSheet();

    expect(screen.getByRole('header', { name: 'Remove from library?' })).toBeOnTheScreen();
    expect(
      screen.getByText('Your status, progress, score and notes for this title will be deleted.'),
    ).toBeOnTheScreen();
    expect(button('Close without removing')).toBeOnTheScreen();
    expect(button('Cancel')).toBeOnTheScreen();
    expect(button('Remove')).toBeEnabled();
  });

  it('removes on Remove, then closes', async () => {
    const { onConfirm, onClose, user } = await renderSheet();

    await user.press(button('Remove'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['Cancel', 'Close without removing'])('only closes on %s', async (name) => {
    const { onConfirm, onClose, user } = await renderSheet();

    await user.press(button(name));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', async () => {
    await renderSheet(false);

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeOnTheScreen();
  });
});
