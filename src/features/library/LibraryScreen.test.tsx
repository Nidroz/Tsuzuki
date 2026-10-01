import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { LibraryScreen } from './LibraryScreen';

const TEST_ID = 'library-screen';
const TITLE = 'Coming soon';
const MESSAGE = 'The anime and manga you follow will appear here.';
const FRENCH_MESSAGE = 'Les anime et manga que vous suivez apparaîtront ici.';

describe('LibraryScreen', () => {
  it('renders the screen with its test id', async () => {
    await renderWithProviders(<LibraryScreen />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });

  it('shows the placeholder title and message in english', async () => {
    await renderWithProviders(<LibraryScreen />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
  });

  it('shows the placeholder message in french', async () => {
    await renderWithProviders(<LibraryScreen />, 'fr');

    expect(screen.getByText(FRENCH_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText(MESSAGE)).not.toBeOnTheScreen();
  });
});
