import { describe, expect, it, jest } from '@jest/globals';
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import en from '../../src/core/i18n/en.json';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES } from './app-routes';

// an english device: the root layout resolves the language from it
const DEVICE_LOCALES: readonly Pick<Localization.Locale, 'languageTag'>[] = [
  { languageTag: 'en-US' },
];

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => DEVICE_LOCALES,
}));

const VALID_TEST_ID = 'media-detail-screen';
const INVALID_TEST_ID = 'media-detail-invalid';
// the native stack header only shows up as this react-native-screens host component, whose title
// prop is the header title
const NATIVE_HEADER_HOST = 'RNSScreenStackHeaderConfig';

// a cold deep link: the app starts on the url
const openLink = (url: string) => renderRouterAsync(APP_ROUTES, { initialUrl: url });

const headerTitles = () =>
  screen.container
    .queryAll(({ type }) => type === NATIVE_HEADER_HOST)
    .map(({ props }) => (props as { title?: unknown }).title);

describe('media detail route', () => {
  it.each([
    ['/media/anime/1', 'Anime #1: details coming soon'],
    ['/media/manga/42', 'Manga #42: details coming soon'],
  ])('shows the placeholder of the valid link %s', async (url, text) => {
    const router = await openLink(url);

    expect(router.getPathname()).toBe(url);
    expect(screen.getByTestId(VALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
  });

  it('titles its stack header in the app language', async () => {
    await openLink('/media/anime/1');

    expect(headerTitles()).toContain(en.mediaDetail.title);
  });

  it('keeps Discover below a cold deep link, so back leads to it', async () => {
    const router = await openLink('/media/manga/42');

    expect(appRouter.canGoBack()).toBe(true);
    await act(() => {
      appRouter.back();
    });

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
  });

  it.each([
    ['an unknown kind', '/media/movie/1'],
    ['an id that is not a number', '/media/anime/abc'],
    ['an id that is not positive', '/media/anime/0'],
  ])('shows a translated error for %s', async (_case, url) => {
    await openLink(url);

    expect(screen.getByTestId(INVALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.invalidLink.title)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.invalidLink.message)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
  });

  it('goes back to Discover from an invalid link', async () => {
    const user = userEvent.setup();
    const router = await openLink('/media/anime/abc');

    await user.press(screen.getByRole('button', { name: en.mediaDetail.invalidLink.action }));

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
    // dismissed to the tabs below, not pushed: one Discover, no invalid link left to go back to
    expect(appRouter.canGoBack()).toBe(false);
  });
});
