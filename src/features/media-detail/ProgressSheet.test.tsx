import type { MediaKind } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ProgressSheet } from './ProgressSheet';

const FIELD_TEST_ID = 'media-detail-library-progress-input';
const ERROR_TEST_ID = `${FIELD_TEST_ID}-error`;
const SAVE_TEST_ID = 'media-detail-library-progress-sheet-confirm';
const INVALID = 'Enter a whole number, 0 or more.';
const TOTAL = 28;

interface Setup {
  readonly progress?: number;
  readonly totalUnits?: number | null;
  readonly kind?: MediaKind;
}

const renderSheet = async ({ progress = 12, totalUnits = TOTAL, kind = 'anime' }: Setup = {}) => {
  const onSave = jest.fn<(progress: number) => void>();
  const onClose = jest.fn();
  const sheet = (visible: boolean) => (
    <ProgressSheet
      visible={visible}
      kind={kind}
      progress={progress}
      totalUnits={totalUnits}
      onSave={onSave}
      onClose={onClose}
    />
  );
  const { rerender } = await renderWithProviders(sheet(true));
  const setVisible = async (visible: boolean) => {
    await rerender(sheet(visible));
  };
  return { onSave, onClose, setVisible, user: userEvent.setup() };
};

const field = () => screen.getByTestId(FIELD_TEST_ID);
const saveButton = () => screen.getByTestId(SAVE_TEST_ID);
const typeText = async (text: string) => {
  await fireEvent.changeText(field(), text);
};

describe('ProgressSheet', () => {
  it.each<[MediaKind, string]>([
    ['anime', 'Episodes watched'],
    ['manga', 'Chapters read'],
  ])('shows the progress of a %s in a labelled number field', async (kind, label) => {
    await renderSheet({ kind });

    expect(screen.getByRole('header', { name: 'Progress' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Close without changing the progress' }),
    ).toBeOnTheScreen();
    expect(field()).toHaveAccessibleName(label);
    expect(field()).toHaveDisplayValue('12');
    expect(field()).toHaveProp('keyboardType', 'number-pad');
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();
  });

  it('saves a typed progress, then closes', async () => {
    const { onSave, onClose, user } = await renderSheet();

    await typeText('20');
    await user.press(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(20);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves from the keyboard, and only closes for an unchanged progress', async () => {
    const { onSave, onClose } = await renderSheet();

    await fireEvent(field(), 'submitEditing');

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    await typeText(' 007 ');
    await fireEvent(field(), 'submitEditing');

    expect(onSave).toHaveBeenCalledWith(7);
  });

  it.each([
    ['blank text', '  '],
    ['a word', 'abc'],
    ['a negative number', '-1'],
    ['a fraction', '1.5'],
  ])('shows an error and disables Save for %s', async (_case, text) => {
    const { onSave, onClose } = await renderSheet();

    await typeText(text);

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(INVALID);
    expect(saveButton()).toBeDisabled();

    await fireEvent(field(), 'submitEditing');

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('accepts the known total but not above it (BR-01)', async () => {
    await renderSheet();

    await typeText('29');

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent('Enter at most 28.');
    expect(saveButton()).toBeDisabled();

    await typeText('28');

    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();
  });

  it('has no upper bound but the storage one when the total is unknown', async () => {
    const { onSave, user } = await renderSheet({ totalUnits: null });

    await typeText('1500');
    await user.press(saveButton());

    expect(onSave).toHaveBeenCalledWith(1500);

    await typeText('99999999999');

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(INVALID);
  });

  it('discards the text on close: the next opening starts from the entry progress', async () => {
    const { onSave, onClose, setVisible, user } = await renderSheet();

    await typeText('3');
    await user.press(screen.getByRole('button', { name: 'Close without changing the progress' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();

    await setVisible(false);
    await setVisible(true);

    expect(field()).toHaveDisplayValue('12');
  });
});
