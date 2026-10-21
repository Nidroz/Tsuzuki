import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { refocusScreens } from '../../../test/mobile/fake-focus-effect';
import {
  inListOrder,
  renderLibraryScreen,
  settle,
  textsInListOrder,
} from '../../../test/mobile/render-library-screen';
import { BERSERK, FRIEREN, MONSTER } from './__fixtures__/library-entries';
import { libraryEntryTestID } from './LibraryEntryRow';

// fR-12, FR-14, BR-02: a row acted on keeps its place until the screen gains focus again

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted, again on refocusScreens()
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
}));

// later than every change of the fixtures: a `+1` makes its entry the last change, first of its
// group under the default sort once laid out again
const AFTER_EVERY_CHANGE = Date.parse('2026-04-01T00:00:00.000Z');

const HEADERS_AND_TITLES =
  /^(?:(?:In progress|Planned|Completed) \(\d+\)|Sousou no Frieren|Berserk|Monster|Mushishi)$/u;
const SHOWN_FIRST = [
  'In progress (2)',
  'Sousou no Frieren',
  'Berserk',
  'Planned (1)',
  'Monster',
  'Completed (1)',
  'Mushishi',
];
// the `+1` buttons, named after their row
const ADD_ONE = /^Add one /u;
const BERSERK_POSITION = 1;

const shownInOrder = () => textsInListOrder(HEADERS_AND_TITLES);
const row = (key: typeof FRIEREN.key) => screen.getByTestId(libraryEntryTestID(key));

// the `+1` button of the row at `position` in the list, whichever entry it shows
const addButtonAt = (position: number) => {
  const button = inListOrder(screen.getAllByRole('button', { name: ADD_ONE }))[position];
  if (button === undefined) {
    throw new Error(`no \`+1\` button at position ${String(position)}`);
  }
  return button;
};

describe('LibraryScreen layout', () => {
  it('lands two quick `+1` taps on the row tapped, which keeps its place (FR-12)', async () => {
    jest.setSystemTime(AFTER_EVERY_CHANGE);
    const { user, repository } = await renderLibraryScreen();
    await settle();
    expect(addButtonAt(BERSERK_POSITION)).toHaveAccessibleName('Add one chapter, Berserk');

    await user.press(addButtonAt(BERSERK_POSITION));
    await user.press(addButtonAt(BERSERK_POSITION));

    expect(shownInOrder()).toStrictEqual(SHOWN_FIRST);
    expect(row(BERSERK.key)).toHaveAccessibleName('Berserk, Manga, 366 chapters');
    expect(row(FRIEREN.key)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 12 / 28 episodes, My score 9 / 10',
    );

    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(BERSERK.key)).toMatchObject({ progress: BERSERK.progress + 2 });
    expect(repository.stored(FRIEREN.key)).toStrictEqual(FRIEREN);
    // the list read again after the write: still the same layout
    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(shownInOrder()).toStrictEqual(SHOWN_FIRST);

    await refocusScreens();

    expect(shownInOrder()).toStrictEqual([
      'In progress (2)',
      'Berserk',
      'Sousou no Frieren',
      ...SHOWN_FIRST.slice(SHOWN_FIRST.indexOf('Planned (1)')),
    ]);
  });

  it('keeps a planned entry under Planned on its first episode until the screen gains focus again (BR-02)', async () => {
    const { user } = await renderLibraryScreen();
    await settle();

    await user.press(screen.getByRole('button', { name: 'Add one episode, Monster' }));
    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(shownInOrder()).toStrictEqual(SHOWN_FIRST);
    expect(row(MONSTER.key)).toHaveAccessibleName('Monster, TV, 1 / 74 episodes, My score 8 / 10');

    await refocusScreens();

    expect(screen.getByRole('header', { name: 'In progress (3)' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Planned (1)' })).not.toBeOnTheScreen();
  });

  it('lays the list out again on an option change', async () => {
    jest.setSystemTime(AFTER_EVERY_CHANGE);
    const { user } = await renderLibraryScreen();
    await settle();

    await user.press(screen.getByRole('button', { name: 'Add one chapter, Berserk' }));
    await user.press(screen.getByRole('radio', { name: 'Title' }));
    await user.press(screen.getByRole('radio', { name: 'Last updated' }));

    expect(shownInOrder().slice(0, SHOWN_FIRST.indexOf('Planned (1)'))).toStrictEqual([
      'In progress (2)',
      'Berserk',
      'Sousou no Frieren',
    ]);
  });
});
