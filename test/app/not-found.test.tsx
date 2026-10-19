import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES } from './app-routes';
import { headerTitles, visibleBackButtons } from './native-header';

// the composition root gets a fake provider instead of the tenrai one: the Discover route, the
// initial tab, loads its top list without http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

// the device language, read by the root layout. the factory runs before this mock is initialized:
// it calls it lazily
const mockDeviceLanguageTag = jest.fn<() => string>();

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: mockDeviceLanguageTag() }],
}));

const NOT_FOUND_TEST_ID = 'not-found-screen';
const UNKNOWN_PATH = '/nowhere/at/all';

const openLink = (url: string) => renderRouterAsync(APP_ROUTES, { initialUrl: url });

describe('not found route', () => {
  beforeEach(() => {
    mockDeviceLanguageTag.mockReturnValue('en-US');
  });

  // a media link takes a namespace, a kind and an id: a shorter one, such as the links from before
  // the namespace segment (/media/anime/1), matches no route
  it.each(['/nowhere', UNKNOWN_PATH, '/media/anime', '/media/anime/1', '/media/mal/anime'])(
    'shows the translated not found screen for the unknown path %s',
    async (url) => {
      await openLink(url);

      expect(screen.getByTestId(NOT_FOUND_TEST_ID)).toBeOnTheScreen();
      expect(screen.getByText(en.notFound.title)).toBeOnTheScreen();
      expect(screen.getByText(en.notFound.message)).toBeOnTheScreen();
      expect(headerTitles()).toContain(en.notFound.title);
    },
  );

  it('is translated on a french device', async () => {
    mockDeviceLanguageTag.mockReturnValue('fr-FR');

    await openLink(UNKNOWN_PATH);

    expect(screen.getByText(fr.notFound.title)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: fr.notFound.action })).toBeOnTheScreen();
    expect(headerTitles()).toContain(fr.notFound.title);
  });

  it('goes back to Discover from an unknown path', async () => {
    const user = userEvent.setup();
    const router = await openLink(UNKNOWN_PATH);

    await user.press(screen.getByRole('button', { name: en.notFound.action }));

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId(NOT_FOUND_TEST_ID)).not.toBeOnTheScreen();
    expect(appRouter.canGoBack()).toBe(false);
  });
  it('shows no untranslated back title or back menu over the tabs', async () => {
    await openLink('/nowhere');

    expect(visibleBackButtons()).toStrictEqual([
      { backTitle: undefined, minimal: true, disableBackButtonMenu: true },
    ]);
  });
});
