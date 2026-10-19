import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { ScrollView } from 'react-native';

import {
  answersEveryTopPage,
  LAST_PAGE,
  rowOf,
} from '../../src/features/discovery/__fixtures__/discovery-pages';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { advance } from '../mobile/render-discovery-screen';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES } from './app-routes';

// fR-04, FR-05, C-08: the Discover tab stays mounted under the media detail route, so going back
// shows the section, the format, the page and the list the user left, without a request or a scroll

// the composition root gets a fake provider instead of the tenrai one: no http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

const OPENED_PAGE = 2;
const MANGA_SECTION = 'discover-section-topManga';
const MANHWA_FORMAT = 'discover-format-manhwa';

// the provider the root layout wraps: the mocked factory always returns the same one
const getTop = jest.mocked(
  jest
    .requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider(TENRAI_INSTANCE).getTop,
);

describe('Discover position (FR-04, FR-05)', () => {
  beforeEach(() => {
    getTop.mockReset();
    getTop.mockImplementation(answersEveryTopPage);
  });

  it('keeps the section, the format, the page and its list after opening a row and going back', async () => {
    const user = userEvent.setup();
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });
    await advance(0);
    await user.press(screen.getByTestId(MANGA_SECTION));
    await advance(0);
    await user.press(screen.getByTestId(MANHWA_FORMAT));
    await advance(0);
    // every scroll of the list ends in this mock, its scrollToOffset too (List.test.tsx): its calls
    // outlive a test, hence the clear
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockClear();
    await user.press(screen.getByRole('button', { name: 'Next page' }));
    await advance(0);
    expect(screen.getByTestId(rowOf('manga', OPENED_PAGE))).toBeOnTheScreen();
    // its prefetch, in the background, or its foreground request
    expect(getTop.mock.calls.map(([params]) => params)).toContainEqual({
      kind: 'manga',
      format: 'manhwa',
      page: OPENED_PAGE,
    });
    // the page change scrolled to the top: the spy sees the scrolls of this list
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0, animated: false }));
    const requests = getTop.mock.calls.length;

    await user.press(screen.getByTestId(rowOf('manga', OPENED_PAGE)));
    await advance(0);
    expect(screen.getByTestId('media-detail-screen')).toBeOnTheScreen();
    scrollTo.mockClear();

    await act(() => {
      appRouter.back();
    });
    await advance(0);

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
    expect(screen.getByTestId(MANGA_SECTION)).toBeChecked();
    expect(screen.getByTestId(MANHWA_FORMAT)).toBeChecked();
    expect(screen.getByTestId(rowOf('manga', OPENED_PAGE))).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: `Page ${String(OPENED_PAGE)} of ${String(LAST_PAGE)}, current page`,
      }),
    ).toBeOnTheScreen();
    // no request at all since the row was opened: neither page 1 nor the page shown again
    expect(getTop).toHaveBeenCalledTimes(requests);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
