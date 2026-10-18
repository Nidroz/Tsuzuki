import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { BERSERK_DETAIL, FRIEREN_DETAIL } from './__fixtures__/media-details';
import { MediaDetailScreen } from './MediaDetailScreen';

const INVALID_TITLE = 'This link is not valid';
const INVALID_MESSAGE = 'It does not lead to an anime or a manga.';
const FRENCH_ACTION = 'Aller à Découvrir';
// the id namespace of MyAnimeList ids, the only one the catalog serves
const MAL = 'mal';

const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo }),
}));

const VALID_TEST_ID = 'media-detail-screen';
const CONTENT_TEST_ID = 'media-detail-content';
const INVALID_TEST_ID = 'media-detail-invalid';

describe('MediaDetailScreen', () => {
  beforeEach(() => {
    mockDismissTo.mockClear();
  });

  it.each([
    ['anime', FRIEREN_DETAIL],
    ['manga', BERSERK_DETAIL],
  ])('shows the details of a valid %s link, fetched with its parsed key', async (kind, detail) => {
    const provider = createStrictFakeCatalogProvider({
      getDetail: () => Promise.resolve(detail),
    });
    await renderWithProviders(
      <MediaDetailScreen params={{ namespace: MAL, kind, id: String(detail.key.externalId) }} />,
      { catalogProvider: provider },
    );

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(VALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: detail.title })).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
    expect(provider.getDetail).toHaveBeenCalledWith(
      { namespace: MAL, kind, externalId: detail.key.externalId },
      expect.any(AbortSignal),
    );
  });

  it('shows the details in french', async () => {
    const provider = createStrictFakeCatalogProvider({
      getDetail: () => Promise.resolve(BERSERK_DETAIL),
    });
    await renderWithProviders(
      <MediaDetailScreen params={{ namespace: MAL, kind: 'manga', id: '2' }} />,
      { language: 'fr', catalogProvider: provider },
    );

    expect(await screen.findByLabelText('Statut, En cours de publication')).toBeOnTheScreen();
  });

  it.each<[string, unknown]>([
    ['an unknown namespace', { namespace: 'anilist', kind: 'anime', id: '1' }],
    ['an uppercase namespace', { namespace: 'MAL', kind: 'anime', id: '1' }],
    ['a missing namespace', { kind: 'anime', id: '1' }],
    ['an unknown kind', { namespace: MAL, kind: 'novel', id: '1' }],
    ['an id that is not a number', { namespace: MAL, kind: 'anime', id: 'abc' }],
    ['a missing id', { namespace: MAL, kind: 'manga' }],
    ['repeated params', { namespace: MAL, kind: 'anime', id: ['1', '2'] }],
  ])('shows a translated error for %s, fetching nothing', async (_case, params) => {
    const provider = createStrictFakeCatalogProvider();
    await renderWithProviders(<MediaDetailScreen params={params} />, {
      catalogProvider: provider,
    });

    expect(screen.getByTestId(INVALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(INVALID_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(INVALID_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
    expect(provider.getDetail).not.toHaveBeenCalled();
  });

  it('goes back to Discover from an invalid link, without any other navigation', async () => {
    const user = userEvent.setup();
    await renderWithProviders(<MediaDetailScreen params={{ namespace: MAL, kind: 'anime' }} />, {
      language: 'fr',
    });

    await user.press(screen.getByRole('button', { name: FRENCH_ACTION }));

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith('/');
  });
});
