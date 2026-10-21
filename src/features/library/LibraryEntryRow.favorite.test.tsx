import { describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import {
  renderLibraryScreen,
  settle,
  textsInListOrder,
} from '../../../test/mobile/render-library-screen';
import { FRIEREN, MONSTER } from './__fixtures__/library-entries';
import { libraryEntryTestID } from './LibraryEntryRow';

// fR-15: the heart of the library rows

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const WRITE_FAILURE = new Error('storage is full');
const FRIEREN_HEART = `${libraryEntryTestID(FRIEREN.key)}-favorite`;
const ADD_FAVORITE = 'Add Sousou no Frieren to favorites';
const REMOVE_FAVORITE = 'Remove Sousou no Frieren from favorites';
const HEADERS_AND_TITLES =
  /^(?:(?:In progress|Planned|Completed) \(\d+\)|Sousou no Frieren|Berserk|Monster|Mushishi)$/u;

const heart = () => screen.getByTestId(FRIEREN_HEART);

describe('LibraryEntryRow favorite (FR-15)', () => {
  it('toggles the favorite on and off in place, the entry kept', async () => {
    const { user, repository } = await renderLibraryScreen();
    await settle();
    const shownFirst = textsInListOrder(HEADERS_AND_TITLES);

    expect(heart()).toHaveAccessibleName(ADD_FAVORITE);
    expect(heart()).not.toBeSelected();

    await user.press(heart());
    await settle();

    expect(repository.stored(FRIEREN.key)).toMatchObject({
      isFavorite: true,
      status: FRIEREN.status,
      progress: FRIEREN.progress,
      media: FRIEREN.media,
    });
    expect(heart()).toHaveAccessibleName(REMOVE_FAVORITE);
    expect(heart()).toBeSelected();
    expect(textsInListOrder(HEADERS_AND_TITLES)).toStrictEqual(shownFirst);

    await user.press(screen.getByRole('button', { name: REMOVE_FAVORITE }));
    await settle();

    expect(repository.stored(FRIEREN.key)).toMatchObject({ isFavorite: false });
    expect(heart()).toHaveAccessibleName(ADD_FAVORITE);
    expect(textsInListOrder(HEADERS_AND_TITLES)).toStrictEqual(shownFirst);
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('shows a favorite as selected', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([{ ...MONSTER, isFavorite: true }]),
    });
    await settle();

    expect(screen.getByRole('button', { name: 'Remove Monster from favorites' })).toBeSelected();
  });

  it('shows a failed toggle under its row, and the stored value again', async () => {
    const repository = createFakeLibraryRepository([FRIEREN]);
    repository.beforeCall.mockImplementation((method) =>
      method === 'save' ? Promise.reject(WRITE_FAILURE) : Promise.resolve(),
    );
    const { user } = await renderLibraryScreen({ repository });
    await settle();

    await user.press(heart());
    await settle();

    expect(screen.getByTestId(`${libraryEntryTestID(FRIEREN.key)}-error`)).toHaveTextContent(
      'Your change could not be saved.',
      { exact: false },
    );
    await waitFor(() => {
      expect(heart()).toHaveAccessibleName(ADD_FAVORITE);
    });
  });

  it('names the heart in french', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([FRIEREN]),
      language: 'fr',
    });
    await settle();

    expect(heart()).toHaveAccessibleName('Ajouter Sousou no Frieren aux favoris');
  });
});
