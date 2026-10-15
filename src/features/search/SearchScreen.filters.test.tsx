import type { MediaSummary, Page } from '@core/catalog/catalog-provider';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import {
  advance,
  renderSearchScreen,
  searchInput,
} from '../../../test/mobile/render-search-screen';
import { genresByKind } from './__fixtures__/genres';
import { FRIEREN, pageOf } from './__fixtures__/search-results';

// fR-03: the filters button and sheet on the search screen, and the searches they run

const mockPush = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

const FRIEREN_ROW = 'search-result-mal-anime-52991';

const answers = (page: Page<MediaSummary>) => (): Promise<Page<MediaSummary>> =>
  Promise.resolve(page);

const renderScreen = (recentSearches: readonly string[] = ['mushishi']) =>
  renderSearchScreen({ search: answers(pageOf(FRIEREN)), getGenres: genresByKind, recentSearches });

const button = (name: string) => screen.getByRole('button', { name });

describe('SearchScreen filters (FR-03)', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockPush.mockClear();
    user = userEvent.setup();
  });

  // opens the sheet, presses the given buttons in it, then applies
  const applyFilters = async (...names: string[]) => {
    await user.press(screen.getByTestId('search-filters'));
    await advance(0);
    for (const name of names) {
      await user.press(button(name));
    }
    await user.press(screen.getByTestId('filters-apply'));
    await advance(0);
  };

  it('shows the filters button beside the kind switch, closed sheet, no count', async () => {
    const { provider } = await renderScreen();

    expect(button('Filters')).toHaveTextContent('Filters');
    expect(screen.queryByTestId('filters-sheet')).not.toBeOnTheScreen();
    expect(provider.getGenres).not.toHaveBeenCalled();

    await user.press(button('Filters'));
    await advance(0);

    expect(screen.getByTestId('filters-sheet')).toBeOnTheScreen();
    expect(provider.getGenres).toHaveBeenCalledWith('anime', expect.any(AbortSignal));
  });

  it('searches by filters alone with an empty field, showing results instead of the recent searches', async () => {
    const { provider } = await renderScreen();
    expect(screen.getByTestId('search-recent')).toBeOnTheScreen();

    await user.press(screen.getByTestId('search-filters'));
    await advance(0);
    await user.press(button('TV'));
    await user.press(button('Action, not filtered'));
    await user.press(button('Drama, not filtered'));
    await user.press(button('Drama, included'));
    await user.press(button('Finished'));
    await user.type(screen.getByTestId('filters-year'), '2015');
    await user.press(button('Score 7 or more'));
    await user.press(button('Popularity'));
    await user.press(screen.getByTestId('filters-apply'));
    await advance(0);

    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(
      {
        kind: 'anime',
        formats: ['tv'],
        genresIncluded: [1],
        genresExcluded: [8],
        status: 'finished',
        yearFrom: 2015,
        minScore: 7,
        sort: { field: 'popularity', direction: 'desc' },
        page: 1,
      },
      expect.any(AbortSignal),
    );
    expect(screen.queryByTestId('filters-sheet')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('search-recent')).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(button('Filters, 7 active')).toHaveTextContent('Filters (7)');
  });

  it('never records a search run by filters alone, even when a result is opened', async () => {
    const { repository } = await renderScreen();
    await applyFilters('Score 8 or more');

    await user.press(screen.getByTestId(FRIEREN_ROW));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.stored()).toStrictEqual(['mushishi']);
  });

  it('searches the debounced text together with the applied filters', async () => {
    const { provider } = await renderScreen();
    await applyFilters('Upcoming');

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', query: 'frieren', status: 'upcoming', page: 1 },
      expect.any(AbortSignal),
    );
  });

  it('clears the format and the genres on a kind change, keeping the other filters', async () => {
    const { provider } = await renderScreen();
    await applyFilters('Movie', 'Action, not filtered', 'Score 7 or more');
    expect(button('Filters, 3 active')).toBeOnTheScreen();

    await user.press(button('Manga'));
    await advance(0);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'manga', minScore: 7, page: 1 },
      expect.any(AbortSignal),
    );
    expect(button('Filters, 1 active')).toBeOnTheScreen();

    // pressing the current kind again changes nothing
    await user.press(button('Manga'));
    await advance(0);

    expect(button('Filters, 1 active')).toBeOnTheScreen();
  });

  it('runs no search when the sheet is closed without Apply', async () => {
    const { provider } = await renderScreen();
    await user.press(screen.getByTestId('search-filters'));
    await advance(0);
    await user.press(button('TV'));

    await user.press(button('Close the filters without applying them'));
    await advance(SEARCH_DEBOUNCE_MS);

    expect(provider.search).not.toHaveBeenCalled();
    expect(button('Filters')).toBeOnTheScreen();
    expect(screen.getByTestId('search-recent')).toBeOnTheScreen();
  });

  it('shows the recent searches again once the filters are reset and the field is empty', async () => {
    const { provider } = await renderScreen();
    await applyFilters('Score 9 or more');
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();

    await applyFilters('Reset');

    expect(screen.getByTestId('search-recent')).toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(button('Filters')).toBeOnTheScreen();
  });
});
