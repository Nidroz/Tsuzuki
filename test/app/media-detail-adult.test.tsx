import type { CatalogProvider } from '@core/catalog/catalog-provider';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { SHOW_ADULT_PREFERENCE_KEY } from '@core/preferences/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';

import en from '../../src/core/i18n/en.json';
import { ADULT_DETAIL } from '../../src/features/media-detail/__fixtures__/media-details';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync, type RenderedRouter } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import { headerTitles, visibleHeaderTitles } from './native-header';

// bR-06: a deep link to an adult title through the root layout, which reads the adult content
// setting from the app storage

// the composition root gets a fake provider instead of the tenrai one: no http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

// an english device: the root layout resolves the language from it
const DEVICE_LOCALES: readonly Pick<Localization.Locale, 'languageTag'>[] = [
  { languageTag: 'en-US' },
];

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => DEVICE_LOCALES,
}));

// the shared instance lets each test clear the setting and the persisted query cache
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

const CONTENT_TEST_ID = 'media-detail-content';
const HIDDEN_TEST_ID = 'media-detail-hidden';
const LIBRARY_TEST_ID = 'media-detail-library';
const SCREEN_TEST_ID = 'media-detail-screen';
const SETTINGS_TEST_ID = 'settings-screen';

// what of the adult title may never show while the setting is off
const ADULT_TEXTS = [
  ADULT_DETAIL.title,
  ADULT_DETAIL.titleEnglish,
  ADULT_DETAIL.synopsis,
  ...ADULT_DETAIL.genres.map((genre) => genre.name),
].filter((text): text is string => text !== null);

// the provider the root layout wraps: the mocked factory always returns the same one
const getDetail = jest.mocked(
  jest
    .requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider(TENRAI_INSTANCE).getDetail,
);

const answersAdultDetail: CatalogProvider['getDetail'] = () => Promise.resolve(ADULT_DETAIL);

const ADULT_LINK = `/media/mal/anime/${String(ADULT_DETAIL.key.externalId)}`;

// the route names of the root layout's stack, below the router's own root route
const appStackRoutes = (router: RenderedRouter) =>
  router.getRouterState()?.routes[0]?.state?.routes.map((route) => route.name);

// a cold deep link: the app starts on the url
const openAdultLink = () => renderRouterAsync(APP_ROUTES, { initialUrl: ADULT_LINK });

describe('media detail route: adult content setting (BR-06)', () => {
  beforeEach(() => {
    appStorage.clearAll();
    getDetail.mockReset();
    getDetail.mockImplementation(answersAdultDetail);
  });

  it('hides an adult title while the setting is off, its default, showing nothing of it', async () => {
    await openAdultLink();

    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.hidden.title)).toBeOnTheScreen();
    expect(screen.queryByTestId(CONTENT_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(LIBRARY_TEST_ID)).not.toBeOnTheScreen();
    for (const text of ADULT_TEXTS) {
      expect(screen.queryByText(text, { includeHiddenElements: true })).not.toBeOnTheScreen();
    }
  });

  it('titles the header with the static translation, never the adult title', async () => {
    await openAdultLink();
    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();

    expect(visibleHeaderTitles()).toStrictEqual([en.mediaDetail.title]);
    const titles = headerTitles();
    for (const text of ADULT_TEXTS) {
      expect(titles).not.toContain(text);
    }
  });

  it('hides it as well with the setting stored off', async () => {
    appStorage.set(SHOW_ADULT_PREFERENCE_KEY, 'false');
    await openAdultLink();

    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(CONTENT_TEST_ID)).not.toBeOnTheScreen();
  });

  it('shows the adult title with the setting stored on before the app starts', async () => {
    appStorage.set(SHOW_ADULT_PREFERENCE_KEY, 'true');
    await openAdultLink();

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: ADULT_DETAIL.title })).toBeOnTheScreen();
    expect(await screen.findByTestId(LIBRARY_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(HIDDEN_TEST_ID)).not.toBeOnTheScreen();
    // the stack header keeps its static title whatever the setting
    expect(visibleHeaderTitles()).toStrictEqual([en.mediaDetail.title]);
  });

  it('leads a hidden title to the settings tab, leaving no hidden title to go back to', async () => {
    const user = userEvent.setup();
    const router = await openAdultLink();
    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: en.mediaDetail.hidden.action }));

    expect(router.getPathname()).toBe('/settings');
    expect(screen.getByTestId(SETTINGS_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(SCREEN_TEST_ID)).not.toBeOnTheScreen();
    // dismissed to the tabs below, not pushed: the app stack holds one tabs navigator, and back
    // leads to the Discover tab it started on, never to the hidden title
    expect(appStackRoutes(router)).toStrictEqual(['(tabs)']);
    await act(() => {
      appRouter.back();
    });
    expect(router.getPathname()).toBe('/');
    expect(screen.queryByTestId(SCREEN_TEST_ID)).not.toBeOnTheScreen();
    expect(getDetail).toHaveBeenCalledTimes(1);
  });
});
