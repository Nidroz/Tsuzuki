import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { MediaDetail } from '@core/catalog/catalog-provider';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import type { Language } from '@core/i18n/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ADULT_DETAIL } from './__fixtures__/media-details';
import { MediaDetailView, SETTINGS_PATH } from './MediaDetailView';

// bR-06, FR-32: the adult content setting on the detail screen

// the whole router: the hidden state may only navigate to the settings tab
const mockRouter = {
  dismissTo: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn<(href: string) => void>(),
  back: jest.fn(),
};

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => mockRouter,
}));

const HIDDEN_TEST_ID = 'media-detail-hidden';
const CONTENT_TEST_ID = 'media-detail-content';
const LIBRARY_TEST_ID = 'media-detail-library';

const renderView = async (showAdult: boolean, language: Language = 'en') => {
  const provider = createStrictFakeCatalogProvider({
    getDetail: (): Promise<MediaDetail> => Promise.resolve(ADULT_DETAIL),
  });
  const library = createFakeLibraryRepository();
  await renderWithProviders(
    <LibraryContextProvider repository={library}>
      <MediaDetailView mediaKey={ADULT_DETAIL.key} />
    </LibraryContextProvider>,
    { catalogProvider: provider, showAdult, language },
  );
  return { library, user: userEvent.setup() };
};

describe('MediaDetailView adult content setting (BR-06)', () => {
  beforeEach(() => {
    for (const method of Object.values(mockRouter)) {
      method.mockClear();
    }
  });

  it('shows an adult title with its library section while the setting is on', async () => {
    await renderView(true);

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(ADULT_DETAIL.title)).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: 'Add to library' })).toBeOnTheScreen();
    expect(screen.getByTestId(LIBRARY_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(HIDDEN_TEST_ID)).not.toBeOnTheScreen();
  });

  it('opens the settings tab from a hidden title, writing nothing', async () => {
    const { library, user } = await renderView(false);
    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Open settings' }));

    expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).toHaveBeenCalledWith(SETTINGS_PATH);
    expect(SETTINGS_PATH).toBe('/settings');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
    expect(library.get).not.toHaveBeenCalled();
    expect(library.save).not.toHaveBeenCalled();
  });

  it('names the setting and the action in french', async () => {
    await renderView(false, 'fr');

    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Ce titre est un contenu pour adultes. Activez Afficher le contenu adulte dans les Réglages pour le voir.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ouvrir les réglages' })).toBeOnTheScreen();
  });
});
