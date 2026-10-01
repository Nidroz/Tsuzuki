import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { DiscoveryScreen } from './DiscoveryScreen';

const TEST_ID = 'discover-screen';
const TITLE = 'Coming soon';
const MESSAGE = 'Top anime, top manga and the current season will appear here.';
const FRENCH_MESSAGE = 'Les meilleurs anime et manga et la saison en cours apparaîtront ici.';

describe('DiscoveryScreen', () => {
  it('renders the screen with its test id', async () => {
    await renderWithProviders(<DiscoveryScreen />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });

  it('shows the placeholder title and message in english', async () => {
    await renderWithProviders(<DiscoveryScreen />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(MESSAGE)).toBeOnTheScreen();
  });

  it('shows the placeholder message in french', async () => {
    await renderWithProviders(<DiscoveryScreen />, 'fr');

    expect(screen.getByText(FRENCH_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText(MESSAGE)).not.toBeOnTheScreen();
  });
});
