import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import type { Language } from '@core/i18n/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import {
  createDeferred,
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { refocusScreens } from '../../../test/mobile/fake-focus-effect';
import { settle, textsInListOrder } from '../../../test/mobile/render-library-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ADULT, BERSERK, FRIEREN, LIBRARY, MONSTER } from '../library/__fixtures__/library-entries';
import { FavoritesScreen } from './FavoritesScreen';

// fR-15, BR-06: the favorites tab, the library restricted to its favorites

const mockNavigate = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted, again on refocusScreens()
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: mockNavigate }),
}));

const READ_FAILURE = new Error('storage is unreadable');
const HEADERS_AND_TITLES =
  /^(?:(?:In progress|Planned|Completed) \(\d+\)|Sousou no Frieren|Berserk|Monster|Mushishi)$/u;
const FAVORITES = [
  { ...FRIEREN, isFavorite: true },
  BERSERK,
  { ...MONSTER, isFavorite: true },
  { ...ADULT, isFavorite: true },
];

const renderFavorites = async (
  repository: FakeLibraryRepository = createFakeLibraryRepository(FAVORITES),
  language: Language = 'en',
) => {
  await renderWithProviders(
    <LibraryContextProvider repository={repository}>
      <FavoritesScreen />
    </LibraryContextProvider>,
    { language },
  );
  return { repository, user: userEvent.setup() };
};

const shownInOrder = () => textsInListOrder(HEADERS_AND_TITLES);

describe('FavoritesScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('lists the favorites only, grouped, the adult ones hidden and counted', async () => {
    await renderFavorites();
    await settle();

    expect(screen.getByTestId('favorites-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('favorites-list')).toBeOnTheScreen();
    expect(shownInOrder()).toStrictEqual([
      'In progress (1)',
      'Sousou no Frieren',
      'Planned (1)',
      'Monster',
    ]);
    expect(screen.queryByText(BERSERK.media.title)).not.toBeOnTheScreen();
    expect(screen.getByTestId('favorites-list-hidden-note')).toHaveTextContent(
      '1 adult title is hidden.',
    );
    expect(screen.getByTestId('favorites-filters-kind')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Remove Sousou no Frieren from favorites' }),
    ).toBeSelected();
  });

  it('keeps an unfavorited row until the screen gains focus again', async () => {
    const { user, repository } = await renderFavorites();
    await settle();

    await user.press(
      screen.getByRole('button', { name: 'Remove Sousou no Frieren from favorites' }),
    );
    await settle();

    expect(repository.stored(FRIEREN.key)).toMatchObject({ isFavorite: false, status: 'current' });
    expect(shownInOrder()).toStrictEqual([
      'In progress (1)',
      'Sousou no Frieren',
      'Planned (1)',
      'Monster',
    ]);
    expect(
      screen.getByRole('button', { name: 'Add Sousou no Frieren to favorites' }),
    ).not.toBeSelected();

    await refocusScreens();

    expect(shownInOrder()).toStrictEqual(['Planned (1)', 'Monster']);
  });

  it('says how to add favorites when there is none, and opens Search', async () => {
    const { user } = await renderFavorites(createFakeLibraryRepository(LIBRARY));
    await settle();

    expect(screen.getByTestId('favorites-empty')).toBeOnTheScreen();
    expect(screen.getByText('No favorites yet')).toBeOnTheScreen();
    expect(screen.getByText('Tap the heart on a title to add it here.')).toBeOnTheScreen();
    expect(screen.queryByTestId('favorites-filters-kind')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Search titles' }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/search');
  });

  it('shows a labelled spinner while loading, then the library read error with a retry', async () => {
    const read = createDeferred();
    const repository = createFakeLibraryRepository(FAVORITES);
    repository.beforeCall.mockReturnValueOnce(read.promise);
    await renderFavorites(repository);

    expect(screen.getByLabelText('Loading your library')).toHaveProp('testID', 'favorites-loading');

    read.reject(READ_FAILURE);
    await settle();

    expect(screen.getByTestId('favorites-error')).toBeOnTheScreen();
    expect(screen.getByText('Your library could not be loaded')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('shows the empty state in french', async () => {
    await renderFavorites(createFakeLibraryRepository(), 'fr');
    await settle();

    expect(screen.getByText("Aucun favori pour l'instant")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Rechercher des titres' })).toBeOnTheScreen();
    expect(screen.queryByText('No favorites yet')).not.toBeOnTheScreen();
  });
});
