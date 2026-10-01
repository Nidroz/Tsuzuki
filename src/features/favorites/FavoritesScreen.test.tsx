import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FavoritesScreen } from './FavoritesScreen';

const TEST_ID = 'favorites-screen';
const TITLE = 'Coming soon';
const MESSAGE = 'Your favorite titles will appear here.';
const FRENCH_MESSAGE = 'Vos titres favoris apparaîtront ici.';

describe('FavoritesScreen', () => {
  it('renders the screen with its test id', async () => {
    await renderWithProviders(<FavoritesScreen />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });

  it('shows the placeholder title and message in english', async () => {
    await renderWithProviders(<FavoritesScreen />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
  });

  it('shows the placeholder message in french', async () => {
    await renderWithProviders(<FavoritesScreen />, 'fr');

    expect(screen.getByText(FRENCH_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText(MESSAGE)).not.toBeOnTheScreen();
  });
});
