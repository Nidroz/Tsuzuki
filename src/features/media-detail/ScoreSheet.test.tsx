import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ScoreSheet } from './ScoreSheet';

const LABELS = [
  'No score',
  ...Array.from({ length: 10 }, (_, index) => `${String(index + 1)} / 10`),
];

const renderSheet = async (score: number | null) => {
  const onSave = jest.fn<(score: number | null) => void>();
  const onClose = jest.fn();
  const sheet = (visible: boolean) => (
    <ScoreSheet visible={visible} score={score} onSave={onSave} onClose={onClose} />
  );
  const { rerender } = await renderWithProviders(sheet(true));
  const setVisible = async (visible: boolean) => {
    await rerender(sheet(visible));
  };
  return { onSave, onClose, setVisible, user: userEvent.setup() };
};

const radio = (name: string) => screen.getByRole('radio', { name });
const button = (name: string) => screen.getByRole('button', { name });

describe('ScoreSheet', () => {
  it('offers no score then 1 to 10 in a labelled group, the entry score checked', async () => {
    await renderSheet(9);

    expect(screen.getByRole('header', { name: 'My score' })).toBeOnTheScreen();
    expect(button('Close without changing the score')).toBeOnTheScreen();
    expect(screen.getByTestId('media-detail-library-score-options')).toHaveAccessibleName(
      'My score',
    );
    expect(
      screen.getAllByRole('radio').map((option) => option.props.accessibilityLabel as unknown),
    ).toEqual(LABELS);
    expect(radio('9 / 10')).toBeChecked();
  });

  it('checks No score for an entry without a score', async () => {
    await renderSheet(null);

    expect(radio('No score')).toBeChecked();
  });

  it.each<[string, number | null, string, number | null]>([
    ['a score', null, '7 / 10', 7],
    ['the highest score', 3, '10 / 10', 10],
    ['no score, clearing it', 9, 'No score', null],
  ])('saves %s, then closes', async (_case, score, choice, saved) => {
    const { onSave, onClose, user } = await renderSheet(score);

    await user.press(radio(choice));
    await user.press(button('Save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(saved);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only closes on Save when the score is unchanged', async () => {
    const { onSave, onClose, user } = await renderSheet(null);

    await user.press(button('Save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the draft alone when the entry score changes while open, then starts from it', async () => {
    const onSave = jest.fn<(score: number | null) => void>();
    const onClose = jest.fn();
    const sheet = (visible: boolean, score: number | null) => (
      <ScoreSheet visible={visible} score={score} onSave={onSave} onClose={onClose} />
    );
    const { rerender } = await renderWithProviders(sheet(true, 9));
    const user = userEvent.setup();

    // an untouched draft keeps the score of the opening
    await rerender(sheet(true, 5));

    expect(radio('9 / 10')).toBeChecked();

    // an edited draft keeps the edit
    await user.press(radio('2 / 10'));
    await rerender(sheet(true, 6));

    expect(radio('2 / 10')).toBeChecked();

    await user.press(button('Save'));

    expect(onSave).toHaveBeenCalledWith(2);

    // the next opening starts from the latest entry score
    await rerender(sheet(false, 6));
    await rerender(sheet(true, 6));

    expect(radio('6 / 10')).toBeChecked();
  });

  it('discards the draft on close: the next opening starts from the entry score', async () => {
    const { onSave, setVisible, user } = await renderSheet(9);

    await user.press(radio('2 / 10'));
    await user.press(button('Close without changing the score'));
    await setVisible(false);
    await setVisible(true);

    expect(radio('9 / 10')).toBeChecked();
    expect(onSave).not.toHaveBeenCalled();
  });
});
