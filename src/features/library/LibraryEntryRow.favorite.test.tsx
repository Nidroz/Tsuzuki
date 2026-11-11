import { LibraryRemoteError } from '@core/errors/library-errors';
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
// a two-state toggle: a fixed label naming the title, its state told by selected only
const FAVORITE = 'Favorite: Sousou no Frieren';
const HEADERS_AND_TITLES =
  /^(?:(?:In progress|Planned|Completed) \(\d+\)|Sousou no Frieren|Berserk|Monster|Mushishi)$/u;

const heart = () => screen.getByTestId(FRIEREN_HEART);

describe('LibraryEntryRow favorite (FR-15)', () => {
  it('toggles the favorite on and off in place, the entry kept', async () => {
    const { user, repository } = await renderLibraryScreen();
    await settle();
    const shownFirst = textsInListOrder(HEADERS_AND_TITLES);

    expect(heart()).toHaveAccessibleName(FAVORITE);
    expect(heart()).not.toBeSelected();

    await user.press(heart());
    await settle();

    expect(repository.stored(FRIEREN.key)).toMatchObject({
      isFavorite: true,
      status: FRIEREN.status,
      progress: FRIEREN.progress,
      media: FRIEREN.media,
    });
    expect(heart()).toHaveAccessibleName(FAVORITE);
    expect(heart()).toBeSelected();
    expect(textsInListOrder(HEADERS_AND_TITLES)).toStrictEqual(shownFirst);

    await user.press(screen.getByRole('button', { name: FAVORITE }));
    await settle();

    expect(repository.stored(FRIEREN.key)).toMatchObject({ isFavorite: false });
    expect(heart()).toHaveAccessibleName(FAVORITE);
    expect(heart()).not.toBeSelected();
    expect(textsInListOrder(HEADERS_AND_TITLES)).toStrictEqual(shownFirst);
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('shows a favorite as selected', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([{ ...MONSTER, isFavorite: true }]),
    });
    await settle();

    expect(screen.getByRole('button', { name: 'Favorite: Monster' })).toBeSelected();
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
      expect(heart()).not.toBeSelected();
    });
    expect(heart()).toHaveAccessibleName(FAVORITE);
  });

  it('says the library is full under its row when the write is refused for it (R-04)', async () => {
    const repository = createFakeLibraryRepository([FRIEREN]);
    // the entry removed on another device meanwhile: the toggle writes it again, a new entry
    repository.beforeCall.mockImplementation((method) =>
      method === 'save'
        ? Promise.reject(new LibraryRemoteError('library-full'))
        : Promise.resolve(),
    );
    const { user } = await renderLibraryScreen({ repository });
    await settle();

    await user.press(heart());
    await settle();

    const error = screen.getByTestId(`${libraryEntryTestID(FRIEREN.key)}-error`);
    expect(error).toHaveTextContent(
      'Your library is full: it holds 10,000 titles. Remove titles to add new ones.',
      { exact: false },
    );
    expect(error).not.toHaveTextContent('Your change could not be saved.', { exact: false });
  });

  it('names the heart in french', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([FRIEREN]),
      language: 'fr',
    });
    await settle();

    expect(heart()).toHaveAccessibleName('Favori : Sousou no Frieren');
  });
});
