import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SearchScreen } from './SearchScreen';

const TEST_ID = 'search-screen';
const TITLE = 'Coming soon';
const MESSAGE = 'Search anime and manga by title.';
const FRENCH_MESSAGE = 'Recherchez des anime et des manga par titre.';

describe('SearchScreen', () => {
  it('renders the screen with its test id', async () => {
    await renderWithProviders(<SearchScreen />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });

  it('shows the placeholder title and message in english', async () => {
    await renderWithProviders(<SearchScreen />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
  });

  it('shows the placeholder message in french', async () => {
    await renderWithProviders(<SearchScreen />, 'fr');

    expect(screen.getByText(FRENCH_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText(MESSAGE)).not.toBeOnTheScreen();
  });
});
