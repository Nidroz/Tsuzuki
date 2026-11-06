import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import type * as Ui from '@ui/index';
import type * as React from 'react';

import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderLibraryScreen, settle } from '../../../test/mobile/render-library-screen';
import { BERSERK, FRIEREN, MONSTER, MUSHISHI } from './__fixtures__/library-entries';
import { libraryEntryTestID } from './LibraryEntryRow';

// fR-12, FR-14: a row acted on re-renders alone, the other rows keep their render (R-02)

// one router for every render, as expo-router's useRouter gives: a new one per render would give
// the rows a new onOpen, and re-render every row whatever the memo
const mockRouter = { push: jest.fn(), navigate: jest.fn() };

// the testID of each MediaListItem rendered, in render order
const mockRendered: string[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => mockRouter,
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
}));

// the real ui, with each MediaListItem render counted by its testID
jest.mock('@ui/index', () => {
  const actual = jest.requireActual<typeof Ui>('@ui/index');
  const { createElement } = jest.requireActual<typeof React>('react');
  return {
    ...actual,
    MediaListItem: (props: Ui.MediaListItemProps) => {
      mockRendered.push(props.testID ?? '');
      return createElement(actual.MediaListItem, props);
    },
  };
});

const FRIEREN_ROW = libraryEntryTestID(FRIEREN.key);
const OTHER_ROWS = [BERSERK, MONSTER, MUSHISHI].map((entry) => libraryEntryTestID(entry.key));
const ADD_EPISODE = 'Add one episode, Sousou no Frieren';

const rendersOf = (testID: string): number => mockRendered.filter((id) => id === testID).length;

describe('LibraryScreen row renders', () => {
  beforeEach(() => {
    mockRendered.length = 0;
  });

  it('re-renders only the row of a `+1`, through its write and the refetch', async () => {
    const { user, repository } = await renderLibraryScreen();
    await settle();
    for (const testID of [FRIEREN_ROW, ...OTHER_ROWS]) {
      expect(rendersOf(testID)).toBeGreaterThan(0);
    }
    mockRendered.length = 0;

    await user.press(screen.getByRole('button', { name: ADD_EPISODE }));
    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(FRIEREN_ROW)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 13 / 28 episodes, My score 9 / 10',
    );
    expect(rendersOf(FRIEREN_ROW)).toBeGreaterThan(0);
    for (const testID of OTHER_ROWS) {
      expect(rendersOf(testID)).toBe(0);
    }
  });
});
