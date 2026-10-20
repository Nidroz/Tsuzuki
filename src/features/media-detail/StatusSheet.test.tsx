import type { LibraryStatus } from '@core/domain/library-entry';
import type { MediaKind } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { StatusSheet } from './StatusSheet';

const ANIME_LABELS = ['Watching', 'Plan to watch', 'Completed', 'Paused', 'Dropped'];
const MANGA_LABELS = ['Reading', 'Plan to read', 'Completed', 'Paused', 'Dropped'];

const renderSheet = async (status: LibraryStatus = 'current', kind: MediaKind = 'anime') => {
  const onSave = jest.fn<(status: LibraryStatus) => void>();
  const onClose = jest.fn();
  const sheet = (visible: boolean) => (
    <StatusSheet visible={visible} kind={kind} status={status} onSave={onSave} onClose={onClose} />
  );
  const { rerender } = await renderWithProviders(sheet(true));
  const setVisible = async (visible: boolean) => {
    await rerender(sheet(visible));
  };
  return { onSave, onClose, setVisible, user: userEvent.setup() };
};

const radio = (name: string) => screen.getByRole('radio', { name });
const button = (name: string) => screen.getByRole('button', { name });

describe('StatusSheet', () => {
  it('offers the five statuses of an anime, the entry status checked, in a labelled group', async () => {
    await renderSheet('current');

    expect(screen.getByRole('header', { name: 'My status' })).toBeOnTheScreen();
    expect(button('Close without changing the status')).toBeOnTheScreen();
    expect(screen.getByTestId('media-detail-library-status-options')).toHaveAccessibleName(
      'My status',
    );
    expect(
      screen.getAllByRole('radio').map((option) => option.props.accessibilityLabel as unknown),
    ).toEqual(ANIME_LABELS);
    expect(radio('Watching')).toBeChecked();
    expect(button('Save')).toBeEnabled();
  });

  it('words the statuses of a manga with reading (FR-11)', async () => {
    await renderSheet('planned', 'manga');

    expect(
      screen.getAllByRole('radio').map((option) => option.props.accessibilityLabel as unknown),
    ).toEqual(MANGA_LABELS);
    expect(radio('Plan to read')).toBeChecked();
  });

  it('saves the chosen status, then closes', async () => {
    const { onSave, onClose, user } = await renderSheet('current');

    await user.press(radio('Paused'));

    expect(radio('Paused')).toBeChecked();
    expect(onSave).not.toHaveBeenCalled();

    await user.press(button('Save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('paused');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only closes on Save when the status is unchanged', async () => {
    const { onSave, onClose, user } = await renderSheet('completed');

    await user.press(button('Save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('discards the draft on Cancel: the next opening starts from the entry status', async () => {
    const { onSave, onClose, setVisible, user } = await renderSheet('current');

    await user.press(radio('Dropped'));
    await user.press(button('Cancel'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();

    await setVisible(false);
    await setVisible(true);

    expect(radio('Watching')).toBeChecked();
    expect(radio('Dropped')).not.toBeChecked();
  });
});
