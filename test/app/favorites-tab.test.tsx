import type { LibraryEntry } from '@core/domain/library-entry';
import type { GuestLibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { describe, expect, it, jest } from '@jest/globals';
import { userEvent, within } from '@testing-library/react-native';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';

import { entryOf, entryWithMedia, keyOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { settle } from '../mobile/render-library-screen';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';

// fR-15: the favorites tab through the real root layout and tab navigator, over the guest library
// the layout creates: only the favorites are listed, and a row unfavorited there stays until the
// tab gains focus again (the real useFocusEffect), then the empty state shows. the entry itself is
// kept in the library

// the real factory, its calls recorded: the test seeds the repository the layout created
jest.mock('@core/repositories/local/library-repository', () => {
  const actual = jest.requireActual<typeof LocalLibrary>(
    '@core/repositories/local/library-repository',
  );
  return { ...actual, createLocalLibraryRepository: jest.fn(actual.createLocalLibraryRepository) };
});

// no http: the favorites and library tabs never read the catalog
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test clear it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

// read from the mock registry: a static import would load the module before @jest/globals,
// which the hoisted factory above needs
const localLibrary = jest.requireMock<typeof LocalLibrary>(
  '@core/repositories/local/library-repository',
);
const createLocalLibrary = jest.mocked(localLibrary.createLocalLibraryRepository);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// no cover: the rows never load an image
const FAVORITE: LibraryEntry = entryWithMedia({ imageUrl: null }, { isFavorite: true });
const PLAIN: LibraryEntry = entryOf({
  key: keyOf('anime', 19),
  media: { ...FAVORITE.media, title: 'Monster', totalUnits: 74 },
  isFavorite: false,
});
const FAVORITE_ROW = 'library-entry-mal-anime-52991';
const PLAIN_ROW = 'library-entry-mal-anime-19';
const REMOVE_FAVORITE = 'Remove Sousou no Frieren from favorites';
const ADD_FAVORITE = 'Add Sousou no Frieren to favorites';

// the guest library the layout created when it loaded, holding `entries` only
const seedGuestLibrary = async (
  entries: readonly LibraryEntry[],
): Promise<GuestLibraryRepository> => {
  appStorage.clearAll();
  const guestLibrary = createLocalLibrary.mock.results[0]?.value as
    GuestLibraryRepository | undefined;
  if (guestLibrary === undefined) {
    throw new Error('the root layout created no guest library');
  }
  for (const entry of entries) {
    await guestLibrary.save(entry);
  }
  return guestLibrary;
};

const favoritesTab = () => within(screen.getByTestId('favorites-screen'));

describe('favorites tab (FR-15)', () => {
  it('lists the favorites only, and keeps an unfavorited row until the tab regains focus', async () => {
    const guestLibrary = await seedGuestLibrary([FAVORITE, PLAIN]);
    const user = userEvent.setup();

    await renderRouterAsync(APP_ROUTES, { initialUrl: '/favorites' });
    expect(await screen.findByTestId('favorites-list')).toBeOnTheScreen();

    expect(favoritesTab().getByTestId(FAVORITE_ROW)).toHaveTextContent(FAVORITE.media.title, {
      exact: false,
    });
    expect(favoritesTab().queryByTestId(PLAIN_ROW)).not.toBeOnTheScreen();
    expect(favoritesTab().getByTestId(`${FAVORITE_ROW}-favorite`)).toBeSelected();

    await user.press(favoritesTab().getByRole('button', { name: REMOVE_FAVORITE }));
    await settle();

    // stored unfavorited, still in the library; the row stays, its heart off
    await expect(guestLibrary.get(FAVORITE.key)).resolves.toMatchObject({
      isFavorite: false,
      status: FAVORITE.status,
      progress: FAVORITE.progress,
    });
    expect(favoritesTab().getByTestId(FAVORITE_ROW)).toBeOnTheScreen();
    expect(favoritesTab().getByRole('button', { name: ADD_FAVORITE })).not.toBeSelected();
    expect(favoritesTab().queryByTestId('favorites-empty')).not.toBeOnTheScreen();

    // the library tab still lists both entries
    await user.press(screen.getByTestId('tab-library'));
    await settle();
    const libraryTab = within(screen.getByTestId('library-screen'));

    expect(libraryTab.getByTestId(FAVORITE_ROW)).toBeOnTheScreen();
    expect(libraryTab.getByTestId(PLAIN_ROW)).toBeOnTheScreen();

    await user.press(screen.getByTestId('tab-favorites'));
    await settle();

    expect(favoritesTab().getByTestId('favorites-empty')).toBeOnTheScreen();
    expect(favoritesTab().queryByTestId(FAVORITE_ROW)).not.toBeOnTheScreen();
  });

  it('shows the empty state for a library without a favorite', async () => {
    await seedGuestLibrary([PLAIN]);

    await renderRouterAsync(APP_ROUTES, { initialUrl: '/favorites' });

    expect(await screen.findByTestId('favorites-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId(PLAIN_ROW)).not.toBeOnTheScreen();
  });
});
