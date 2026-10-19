import type { CatalogProvider, SearchParams } from '@core/catalog/catalog-provider';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import {
  advance,
  pendingUntilAborted,
  renderSearchScreen,
  searchInput,
} from '../../../test/mobile/render-search-screen';
import { genresByKind } from './__fixtures__/genres';
import { pagedResults, rowOfPage } from './__fixtures__/search-results';

// fR-04, C-06: the pages of the search results on the search screen

// the screen pushes the detail route when a result is opened (SearchScreen.recent.test.tsx)
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));

type Search = CatalogProvider['search'];

const LAST_PAGE = 10;
const JUMP_PAGE = 7;

const frieren = (page: number): SearchParams => ({ kind: 'anime', query: 'frieren', page });

// every page of a search of LAST_PAGE pages, foreground and background
const answersEveryPage: Search = (params) => Promise.resolve(pagedResults(params.page, LAST_PAGE));

// the params of the foreground searches, in order: the prefetches pass a background priority
const foregroundSearches = (provider: { search: jest.Mock<Search> }) =>
  provider.search.mock.calls
    .filter(([, , options]) => options?.priority !== 'background')
    .map(([params]) => params);

const currentPage = (page: number, pageCount: number) =>
  screen.getByRole('button', {
    name: `Page ${String(page)} of ${String(pageCount)}, current page`,
  });

describe('SearchScreen pagination (FR-04)', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  // types frieren and waits for its first page
  const searchFrieren = async (search: Search = answersEveryPage) => {
    const rendered = await renderSearchScreen({ search });
    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);
    return rendered;
  };

  // types a page in the jump field and submits it
  const jumpTo = async (page: number) => {
    await user.type(screen.getByLabelText('Go to page'), String(page), { submitEditing: true });
    await advance(0);
  };

  it('starts on page 1, then requests the jumped, the previous and the next page', async () => {
    const { provider } = await searchFrieren();
    expect(currentPage(1, LAST_PAGE)).toBeOnTheScreen();
    expect(screen.getByTestId(rowOfPage(1))).toBeOnTheScreen();

    await jumpTo(JUMP_PAGE);

    expect(screen.getByTestId(rowOfPage(JUMP_PAGE))).toBeOnTheScreen();
    expect(currentPage(JUMP_PAGE, LAST_PAGE)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Previous page' }));
    await advance(0);

    expect(screen.getByTestId(rowOfPage(JUMP_PAGE - 1))).toBeOnTheScreen();
    expect(foregroundSearches(provider)).toStrictEqual([
      frieren(1),
      frieren(JUMP_PAGE),
      frieren(JUMP_PAGE - 1),
    ]);

    // the page after the one shown was prefetched: it opens from the cache
    await user.press(screen.getByRole('button', { name: 'Next page' }));
    await advance(0);

    expect(screen.getByTestId(rowOfPage(JUMP_PAGE))).toBeOnTheScreen();
    expect(currentPage(JUMP_PAGE, LAST_PAGE)).toBeOnTheScreen();
    expect(foregroundSearches(provider)).toHaveLength(3);
  });

  it('opens a prefetched next page from the cache, without a foreground search', async () => {
    const { provider } = await searchFrieren();

    await user.press(screen.getByRole('button', { name: 'Next page' }));
    await advance(0);

    expect(screen.getByTestId(rowOfPage(2))).toBeOnTheScreen();
    expect(screen.queryByTestId('search-updating')).not.toBeOnTheScreen();
    expect(provider.search).toHaveBeenCalledWith(frieren(2), expect.any(AbortSignal), {
      priority: 'background',
    });
    expect(foregroundSearches(provider)).toStrictEqual([frieren(1)]);
  });

  it('keeps the page shown with the updating spinner while the requested one loads', async () => {
    const { provider } = await searchFrieren();
    provider.search.mockImplementation(pendingUntilAborted);

    await jumpTo(JUMP_PAGE);

    expect(currentPage(JUMP_PAGE, LAST_PAGE)).toBeOnTheScreen();
    expect(screen.getByTestId(rowOfPage(1))).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Updating results' })).toBeOnTheScreen();
  });

  // every foreground search of the new search asks for page 1: never the page left, even once
  describe('a new search from a page past the first', () => {
    // searches frieren, jumps to JUMP_PAGE, and returns the foreground searches made so far
    const fromJumpPage = async () => {
      const rendered = await renderSearchScreen({
        search: answersEveryPage,
        getGenres: genresByKind,
      });
      await user.type(searchInput(), 'frieren');
      await advance(SEARCH_DEBOUNCE_MS);
      await jumpTo(JUMP_PAGE);
      expect(foregroundSearches(rendered.provider).at(-1)).toStrictEqual(frieren(JUMP_PAGE));
      return { ...rendered, before: foregroundSearches(rendered.provider).length };
    };

    it('starts again at page 1 for a new text', async () => {
      const { provider, before } = await fromJumpPage();

      await user.type(searchInput(), ' arc');
      await advance(SEARCH_DEBOUNCE_MS);

      expect(foregroundSearches(provider).slice(before)).toStrictEqual([
        { kind: 'anime', query: 'frieren arc', page: 1 },
      ]);
      expect(currentPage(1, LAST_PAGE)).toBeOnTheScreen();
    });

    it('starts again at page 1 for another kind', async () => {
      const { provider, before } = await fromJumpPage();

      await user.press(screen.getByRole('radio', { name: 'Manga' }));
      await advance(0);

      expect(foregroundSearches(provider).slice(before)).toStrictEqual([
        { kind: 'manga', query: 'frieren', page: 1 },
      ]);
      expect(currentPage(1, LAST_PAGE)).toBeOnTheScreen();
    });

    it('starts again at page 1 for other filters', async () => {
      const { provider, before } = await fromJumpPage();

      await user.press(screen.getByTestId('search-filters'));
      await advance(0);
      await user.press(screen.getByRole('radio', { name: 'TV' }));
      await user.press(screen.getByTestId('filters-apply'));
      await advance(0);

      expect(foregroundSearches(provider).slice(before)).toStrictEqual([
        { kind: 'anime', query: 'frieren', formats: ['tv'], page: 1 },
      ]);
      expect(currentPage(1, LAST_PAGE)).toBeOnTheScreen();
    });
  });

  it('scrolls the results back to the top on a page change', async () => {
    await searchFrieren();
    // the mock of ScrollView.scrollTo is shared: its calls outlive a test (List.test.tsx)
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockClear();

    await jumpTo(JUMP_PAGE);

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 0, animated: false }));
  });
});
