import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { NotesSheet } from './NotesSheet';

const FIELD_TEST_ID = 'media-detail-library-notes-input';
const ERROR_TEST_ID = `${FIELD_TEST_ID}-error`;
const COUNTER_TEST_ID = 'media-detail-library-notes-counter';
const SAVE_TEST_ID = 'media-detail-library-notes-sheet-confirm';
const NOTES = 'rewatch the finale';
const TOO_LONG = 'Notes are limited to 2,000 characters.';
// one code point, two utf-16 code units: the limit counts code points (BR-07)
const EMOJI = '\u{1F600}';

const renderSheet = async (notes: string | null = NOTES) => {
  const onSave = jest.fn<(text: string) => void>();
  const onClose = jest.fn();
  const sheet = (visible: boolean) => (
    <NotesSheet visible={visible} notes={notes} onSave={onSave} onClose={onClose} />
  );
  const { rerender } = await renderWithProviders(sheet(true));
  const setVisible = async (visible: boolean) => {
    await rerender(sheet(visible));
  };
  return { onSave, onClose, setVisible, user: userEvent.setup() };
};

const field = () => screen.getByTestId(FIELD_TEST_ID);
const counter = () => screen.getByTestId(COUNTER_TEST_ID);
const saveButton = () => screen.getByTestId(SAVE_TEST_ID);
const typeText = async (text: string) => {
  await fireEvent.changeText(field(), text);
};

describe('NotesSheet', () => {
  it('shows the notes in a labelled text area, with a labelled character counter', async () => {
    await renderSheet();

    expect(screen.getByRole('header', { name: 'My notes' })).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Close without saving the notes' }),
    ).toBeOnTheScreen();
    expect(field()).toHaveAccessibleName('My notes');
    expect(field()).toHaveDisplayValue(NOTES);
    expect(field()).toHaveProp('multiline', true);
    expect(counter()).toHaveTextContent('18 / 2,000');
    expect(counter()).toHaveAccessibleName('18 of 2,000 characters');
    expect(saveButton()).toBeEnabled();
  });

  it('starts empty for an entry without notes', async () => {
    await renderSheet(null);

    expect(field()).toHaveDisplayValue('');
    expect(counter()).toHaveTextContent('0 / 2,000');
  });

  it('saves the typed text, then closes', async () => {
    const { onSave, onClose, user } = await renderSheet(null);

    await typeText('loved it');
    await user.press(saveButton());

    expect(onSave).toHaveBeenCalledWith('loved it');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves blank text, which clears the notes, and only closes for unchanged notes', async () => {
    const { onSave, onClose, user } = await renderSheet();

    await user.press(saveButton());

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    await typeText('   ');
    await user.press(saveButton());

    expect(onSave).toHaveBeenCalledWith('   ');
  });

  it('counts code points: 2,000 emoji fit, one more character does not (BR-07)', async () => {
    const { onSave, user } = await renderSheet(null);

    await typeText(EMOJI.repeat(2000));

    expect(counter()).toHaveTextContent('2,000 / 2,000');
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();

    await typeText(`${EMOJI.repeat(2000)}a`);

    expect(counter()).toHaveTextContent('2,001 / 2,000');
    expect(classesOf(counter())).toContain('text-danger');
    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(TOO_LONG);
    expect(saveButton()).toBeDisabled();

    await user.press(saveButton());

    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses characters the database cannot store', async () => {
    await renderSheet(null);

    await typeText('a\u0000b');

    expect(screen.getByTestId(ERROR_TEST_ID)).toHaveTextContent(
      'These notes hold characters that cannot be saved.',
    );
    expect(saveButton()).toBeDisabled();
  });

  it('discards the text on Cancel: the next opening starts from the entry notes', async () => {
    const { onSave, setVisible, user } = await renderSheet();

    await typeText('draft');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));
    await setVisible(false);
    await setVisible(true);

    expect(field()).toHaveDisplayValue(NOTES);
    expect(onSave).not.toHaveBeenCalled();
  });
});
