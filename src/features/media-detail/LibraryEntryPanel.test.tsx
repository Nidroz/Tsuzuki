import type { LibraryEntry, LibraryStatus } from '@core/domain/library-entry';
import type { MediaKind } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { entryOf, entryWithMedia, keyOf } from '../../../test/core/library-entry-fixtures';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { LibraryEntryPanel, type LibraryEntryPanelActions } from './LibraryEntryPanel';

const TEST_ID = 'media-detail-library';
// a current anime at 12 of 28 episodes, scored 9, with notes
const ENTRY = entryOf();
const NOTES = ENTRY.notes ?? '';
const MANGA_ENTRY = entryWithMedia(
  { format: 'manga', totalUnits: null },
  { key: keyOf('manga', 2), score: null, notes: null },
);

const createActions = () => ({
  remove: jest.fn<() => void>(),
  setStatus: jest.fn<(status: LibraryStatus) => void>(),
  setProgress: jest.fn<(value: number) => void>(),
  incrementProgress: jest.fn<() => void>(),
  setScore: jest.fn<(score: number | null) => void>(),
  setNotes: jest.fn<(text: string) => void>(),
});

const renderPanel = async (entry: LibraryEntry = ENTRY, kind: MediaKind = 'anime') => {
  const actions = createActions();
  const panelActions: LibraryEntryPanelActions = actions;
  await renderWithProviders(<LibraryEntryPanel entry={entry} kind={kind} actions={panelActions} />);
  return { actions, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });
const fact = (name: string) => screen.getByTestId(`${TEST_ID}-${name}`);

describe('LibraryEntryPanel', () => {
  it('shows the status, progress, score and notes of an anime entry, each read as one fact', async () => {
    await renderPanel();

    expect(fact('status')).toHaveAccessibleName('My status, Watching');
    expect(fact('progress')).toHaveAccessibleName('Progress, 12 / 28 episodes');
    expect(fact('score')).toHaveAccessibleName('My score, 9 / 10');
    expect(fact('notes')).toHaveAccessibleName(`My notes, ${NOTES}`);
    expect(button('Add one episode')).toBeEnabled();
    for (const label of ['Edit my status', 'Edit the progress', 'Edit my score', 'Edit my notes']) {
      expect(button(label)).toHaveTextContent('Edit');
    }
    expect(button('Remove from library')).toBeOnTheScreen();
  });

  it('words a manga entry with reading and chapters, without a total, score or notes', async () => {
    await renderPanel(MANGA_ENTRY, 'manga');

    expect(fact('status')).toHaveAccessibleName('My status, Reading');
    expect(fact('progress')).toHaveAccessibleName('Progress, 12 chapters');
    expect(fact('score')).toHaveAccessibleName('My score, No score');
    expect(fact('notes')).toHaveAccessibleName('My notes, No notes');
    expect(button('Add one chapter')).toBeEnabled();
  });

  it('adds one episode with +1', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Add one episode'));

    expect(actions.incrementProgress).toHaveBeenCalledTimes(1);
  });

  it.each<[string, LibraryEntry]>([
    ['at the total', entryOf({ progress: 28, status: 'completed' })],
    ['above a total that dropped', entryWithMedia({ totalUnits: 20 }, { progress: 24 })],
  ])('disables +1 %s (BR-01)', async (_case, entry) => {
    const { actions } = await renderPanel(entry);

    expect(button('Add one episode')).toBeDisabled();

    await fireEvent.press(button('Add one episode'));

    expect(actions.incrementProgress).not.toHaveBeenCalled();
  });

  it('opens the status sheet and saves the chosen status', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Edit my status'));
    await user.press(screen.getByRole('radio', { name: 'Paused' }));
    await user.press(button('Save'));

    expect(actions.setStatus).toHaveBeenCalledWith('paused');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeOnTheScreen();
  });

  it('opens the progress sheet and saves the typed progress', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Edit the progress'));
    await fireEvent.changeText(screen.getByLabelText('Episodes watched'), '20');
    await user.press(button('Save'));

    expect(actions.setProgress).toHaveBeenCalledWith(20);
  });

  it('opens the score sheet and clears the score', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Edit my score'));
    await user.press(screen.getByRole('radio', { name: 'No score' }));
    await user.press(button('Save'));

    expect(actions.setScore).toHaveBeenCalledWith(null);
  });

  it('opens the notes sheet and saves the typed notes', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Edit my notes'));
    await fireEvent.changeText(screen.getByLabelText('My notes'), 'loved it');
    await user.press(button('Save'));

    expect(actions.setNotes).toHaveBeenCalledWith('loved it');
  });

  it('removes the entry only after the confirmation', async () => {
    const { actions, user } = await renderPanel();

    await user.press(button('Remove from library'));

    expect(actions.remove).not.toHaveBeenCalled();

    await user.press(button('Remove'));

    expect(actions.remove).toHaveBeenCalledTimes(1);
  });

  it('writes nothing until a tap', async () => {
    const { actions } = await renderPanel();

    for (const action of Object.values(actions)) {
      expect(action).not.toHaveBeenCalled();
    }
  });
});
