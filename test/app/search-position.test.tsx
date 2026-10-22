import type { CatalogProvider } from '@core/catalog/catalog-provider';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { ScrollView } from 'react-native';

import { pagedResults, rowOfPage } from '../../src/features/search/__fixtures__/search-results';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync } from '../mobile/render-router';
import { advance } from '../mobile/render-search-screen';
import { APP_ROUTES } from './app-routes';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';

// fR-04, C-06: the search tab stays mounted under the media detail route, so going back shows the
// page and the results the user left, without searching again

// no supabase client: the composition root gets a signed-out fake auth repository
jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);

// the composition root gets a fake provider instead of the tenrai one: no http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

const LAST_PAGE = 5;
const OPENED_PAGE = 2;

// the provider the root layout wraps: the mocked factory always returns the same one
const search = jest.mocked(
  jest
    .requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider(TENRAI_INSTANCE).search,
);

const answersEveryPage: CatalogProvider['search'] = (params) =>
  Promise.resolve(pagedResults(params.page, LAST_PAGE));

describe('search position (FR-04)', () => {
  beforeEach(() => {
    search.mockReset();
    search.mockImplementation(answersEveryPage);
  });

  it('keeps the page and its results after opening a result and going back, without scrolling', async () => {
    const user = userEvent.setup();
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: '/search' });
    await user.type(screen.getByTestId('search-input'), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);
    // every scroll of the list ends in this mock, its scrollToOffset too (List.test.tsx): its calls
    // outlive a test, hence the clear
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockClear();
    await user.press(screen.getByRole('button', { name: 'Next page' }));
    await advance(0);
    expect(screen.getByTestId(rowOfPage(OPENED_PAGE))).toBeOnTheScreen();
    // the page change scrolled to the top: the spy sees the scrolls of this list
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0, animated: false }));
    const searches = search.mock.calls.length;

    await user.press(screen.getByTestId(rowOfPage(OPENED_PAGE)));
    await advance(0);
    expect(screen.getByTestId('media-detail-screen')).toBeOnTheScreen();
    scrollTo.mockClear();

    await act(() => {
      appRouter.back();
    });
    await advance(0);

    expect(router.getPathname()).toBe('/search');
    expect(screen.getByTestId(rowOfPage(OPENED_PAGE))).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: `Page ${String(OPENED_PAGE)} of ${String(LAST_PAGE)}, current page`,
      }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('search-input')).toHaveDisplayValue('frieren');
    expect(search).toHaveBeenCalledTimes(searches);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
