import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import { CatalogHttpError, CatalogNetworkError } from '@core/errors/catalog-errors';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { FAKE_SEARCH_QUERY_MAX_LENGTH } from '@core/catalog/__fixtures__/fake-catalog-provider';

import {
  advance,
  pendingUntilAborted,
  renderSearchScreen,
  searchInput,
} from '../../../test/mobile/render-search-screen';
import {
  adultItem,
  FRIEREN,
  FRIEREN_GOLDEN_LAND,
  pageOf,
  SOLO_LEVELING,
} from './__fixtures__/search-results';

const HTTP_SERVICE_UNAVAILABLE = 503;
const FRIEREN_ROW = 'search-result-mal-anime-52991';
const GOLDEN_LAND_ROW = 'search-result-mal-anime-63816';

// the screen pushes the detail route when a result is opened (SearchScreen.recent.test.tsx)
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));

type Search = CatalogProvider['search'];

const resolvesWith =
  (page: Page<MediaSummary>): Search =>
  () =>
    Promise.resolve(page);

// a search that settles with the page the test answers, once the request started
const searchAnsweredByTest = () => {
  let settle: (page: Page<MediaSummary>) => void = () => undefined;
  const search: Search = () =>
    new Promise<Page<MediaSummary>>((resolve) => {
      settle = resolve;
    });
  const answer = (page: Page<MediaSummary>): void => {
    settle(page);
  };
  return { search, answer };
};

const signalOfCall = (provider: { search: jest.Mock<Search> }, call: number) =>
  provider.search.mock.calls[call]?.[1];

describe('SearchScreen', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('shows a labelled field capped at the provider search text limit, then the hint', async () => {
    await renderSearchScreen();

    expect(screen.getByTestId('search-screen')).toBeOnTheScreen();
    expect(searchInput()).toHaveAccessibleName('Search');
    expect(searchInput()).toHaveProp('maxLength', FAKE_SEARCH_QUERY_MAX_LENGTH);
    expect(searchInput()).toHaveProp('placeholder', 'Title of an anime or a manga');
    expect(screen.getByTestId('search-kind-anime')).toBeChecked();
    expect(screen.getByTestId('search-idle')).toBeOnTheScreen();
  });

  it('FR-01: searches 400 ms after the last keystroke, once, with the prepared text', async () => {
    const { provider } = await renderSearchScreen({ search: resolvesWith(pageOf(FRIEREN)) });

    await user.type(searchInput(), '  Frieren ');
    await advance(SEARCH_DEBOUNCE_MS - 1);

    expect(provider.search).not.toHaveBeenCalled();

    await advance(1);

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(
      { kind: 'anime', query: 'Frieren', page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
  });

  it('aborts the outdated search when the text changes', async () => {
    const { provider } = await renderSearchScreen({ search: pendingUntilAborted });
    await user.type(searchInput(), 'fri');
    await advance(SEARCH_DEBOUNCE_MS);
    const first = signalOfCall(provider, 0);
    expect(first?.aborted).toBe(false);

    await user.type(searchInput(), 'eren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(provider.search.mock.calls[1]?.[0]).toStrictEqual({
      kind: 'anime',
      query: 'frieren',
      page: 1,
    });
    expect(first?.aborted).toBe(true);
    expect(signalOfCall(provider, 1)?.aborted).toBe(false);
  });

  it('searches nothing and keeps the hint for blank text', async () => {
    const { provider } = await renderSearchScreen();

    await user.type(searchInput(), '   ', { submitEditing: true });
    await advance(SEARCH_DEBOUNCE_MS);

    expect(provider.search).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-idle')).toBeOnTheScreen();
  });

  it('searches manga when the kind switches', async () => {
    const { provider } = await renderSearchScreen({
      search: (params) =>
        Promise.resolve(pageOf(params.kind === 'manga' ? SOLO_LEVELING : FRIEREN)),
    });
    await user.type(searchInput(), 'solo leveling');
    await advance(SEARCH_DEBOUNCE_MS);

    await user.press(screen.getByRole('radio', { name: 'Manga' }));
    await advance(0);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'manga', query: 'solo leveling', page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId('search-kind-manga')).toBeChecked();
    expect(screen.getByTestId('search-result-mal-manga-121496')).toBeOnTheScreen();
  });

  it('shows a spinner while the first search loads', async () => {
    await renderSearchScreen({ search: pendingUntilAborted });

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByRole('progressbar', { name: 'Loading results' })).toBeOnTheScreen();
  });

  it('shows the first-load spinner, never the old results, for a search typed after a cleared field', async () => {
    const golden = searchAnsweredByTest();
    await renderSearchScreen({
      search: (params, signal) =>
        params.query === 'frieren'
          ? Promise.resolve(pageOf(FRIEREN))
          : golden.search(params, signal),
      recentSearches: ['mushishi'],
    });
    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    await user.clear(searchInput());
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByTestId('search-recent')).toBeOnTheScreen();

    await user.type(searchInput(), 'golden');

    expect(screen.getByTestId('search-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();

    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByTestId('search-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('search-updating')).not.toBeOnTheScreen();

    golden.answer(pageOf(FRIEREN_GOLDEN_LAND));
    await advance(0);

    expect(screen.getByTestId(GOLDEN_LAND_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('search-loading')).not.toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();
  });

  it('says that nothing was found', async () => {
    await renderSearchScreen({ search: resolvesWith(pageOf()) });

    await user.type(searchInput(), 'zzzz');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByText('No results')).toBeOnTheScreen();
  });

  it('says the device looks offline on a network error, and the retry searches again', async () => {
    const search = jest
      .fn<Search>()
      .mockRejectedValueOnce(new CatalogNetworkError())
      .mockResolvedValue(pageOf(FRIEREN));
    const { provider } = await renderSearchScreen({ search });
    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText('You are offline')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('You are offline')).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
  });

  it('shows the generic error for a server error', async () => {
    await renderSearchScreen({
      search: () => Promise.reject(new CatalogHttpError(HTTP_SERVICE_UNAVAILABLE, null)),
    });

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByText('Results could not be loaded')).toBeOnTheScreen();
    expect(screen.queryByText('You are offline')).not.toBeOnTheScreen();
  });

  it('BR-06: hides adult titles and says how many were hidden', async () => {
    await renderSearchScreen({
      search: resolvesWith(pageOf(adultItem(901), FRIEREN, adultItem(902))),
    });

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.queryByText(/^Adult placeholder/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('search-result-mal-anime-901')).not.toBeOnTheScreen();
    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent(
      '2 adult titles were hidden.',
    );
  });

  it('is translated in french', async () => {
    await renderSearchScreen({ language: 'fr', search: resolvesWith(pageOf(FRIEREN)) });

    expect(searchInput()).toHaveAccessibleName('Rechercher');
    expect(screen.getByText('Rechercher des anime et des manga')).toBeOnTheScreen();

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(
      screen.getByRole('button', {
        name: "Sousou no Frieren, Frieren: Beyond Journey's End, TV, 2023, Note 9,24",
      }),
    ).toBeOnTheScreen();
  });
});
