import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { MediaDetailScreen } from './MediaDetailScreen';

const INVALID_TITLE = 'This link is not valid';
const INVALID_MESSAGE = 'It does not lead to an anime or a manga.';
const FRENCH_ACTION = 'Aller à Découvrir';

const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo }),
}));

const VALID_TEST_ID = 'media-detail-screen';
const INVALID_TEST_ID = 'media-detail-invalid';

describe('MediaDetailScreen', () => {
  beforeEach(() => {
    mockDismissTo.mockClear();
  });

  it.each([
    ['anime', '5114', 'Anime #5114: details coming soon'],
    ['manga', '2', 'Manga #2: details coming soon'],
  ])('shows the placeholder of a valid %s link', async (kind, id, text) => {
    await renderWithProviders(<MediaDetailScreen params={{ kind, id }} />);

    expect(screen.getByTestId(VALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
  });

  it('shows the placeholder in french', async () => {
    await renderWithProviders(<MediaDetailScreen params={{ kind: 'anime', id: '1' }} />, 'fr');

    expect(screen.getByText('Anime n° 1 : détails bientôt disponibles')).toBeOnTheScreen();
  });

  it.each<[string, unknown]>([
    ['an unknown kind', { kind: 'novel', id: '1' }],
    ['an id that is not a number', { kind: 'anime', id: 'abc' }],
    ['a missing id', { kind: 'manga' }],
    ['repeated params', { kind: 'anime', id: ['1', '2'] }],
  ])('shows a translated error for %s', async (_case, params) => {
    await renderWithProviders(<MediaDetailScreen params={params} />);

    expect(screen.getByTestId(INVALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(INVALID_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(INVALID_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
  });

  it('goes back to Discover from an invalid link, without any other navigation', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<MediaDetailScreen params={{ kind: 'anime' }} />, 'fr');

    await user.press(screen.getByRole('button', { name: FRENCH_ACTION }));

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith('/');
  });
});
