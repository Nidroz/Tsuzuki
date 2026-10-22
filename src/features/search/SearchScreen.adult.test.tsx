import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import { advance, renderSearchScreen } from '../../../test/mobile/render-search-screen';
import { genresByKind } from './__fixtures__/genres';
import { adultItem, FRIEREN, pageOf } from './__fixtures__/search-results';

// bR-06, FR-03, FR-32: the adult content setting on the search screen. while it is off, an adult
// genre applied while it was on is not searched, nor counted, and comes back once it is on

const mockPush = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

const ADULT_ROW = 'search-result-mal-anime-901';
const FRIEREN_ROW = 'search-result-mal-anime-52991';
// the Hentai genre of ANIME_GENRES
const HENTAI_ID = 12;

const answers = (page: Page<MediaSummary>) => (): Promise<Page<MediaSummary>> =>
  Promise.resolve(page);

// an adult title only for a search including the Hentai genre: what is shown tells what was searched
const answersByGenre: CatalogProvider['search'] = (params) =>
  Promise.resolve(
    params.genresIncluded?.includes(HENTAI_ID) === true
      ? pageOf(adultItem(901), FRIEREN)
      : pageOf(FRIEREN),
  );

const renderScreen = (
  showAdult: boolean,
  search: CatalogProvider['search'] = answers(pageOf(adultItem(901), FRIEREN)),
) => renderSearchScreen({ search, getGenres: genresByKind, showAdult });

const button = (name: string) => screen.getByRole('button', { name });
// a control of the filters sheet: a button, a genre chip or a single-select (radio) chip
const control = (name: string) => screen.getByRole(/^(button|radio)$/, { name });

describe('SearchScreen adult content setting (BR-06)', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockPush.mockClear();
    user = userEvent.setup();
  });

  // opens the sheet, presses the given controls in it, then applies
  const applyFilters = async (...names: string[]) => {
    await user.press(screen.getByTestId('search-filters'));
    await advance(0);
    for (const name of names) {
      await user.press(control(name));
    }
    await user.press(screen.getByTestId('filters-apply'));
    await advance(0);
  };

  it('shows the adult results while on, hidden and counted while off', async () => {
    const { setShowAdult } = await renderScreen(true);
    await applyFilters('Score 7 or more');

    expect(screen.getByTestId(ADULT_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('search-hidden-note')).not.toBeOnTheScreen();

    await setShowAdult(false);
    await advance(0);

    expect(screen.queryByTestId(ADULT_ROW)).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent('1 adult title was hidden.');
  });

  it('leaves an included adult genre out while off, keeps the other genre, and searches it again once on', async () => {
    const { provider, setShowAdult } = await renderScreen(true, answersByGenre);
    await applyFilters('Action, not filtered', 'Hentai, not filtered');

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', genresIncluded: [1, 12], page: 1 },
      expect.any(AbortSignal),
    );

    await setShowAdult(false);
    await advance(0);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', genresIncluded: [1], page: 1 },
      expect.any(AbortSignal),
    );
    expect(button('Filters, 1 active')).toBeOnTheScreen();

    // the search with the adult genre is still cached: its results show again
    await setShowAdult(true);
    await advance(0);

    expect(screen.getByTestId(ADULT_ROW)).toBeOnTheScreen();
    expect(button('Filters, 1 active')).toBeOnTheScreen();
  });

  it('drops an excluded adult genre from the search and from the filters count while off', async () => {
    const { provider, setShowAdult } = await renderScreen(true);
    await applyFilters('Erotica, not filtered', 'Erotica, included', 'Score 7 or more');
    expect(button('Filters, 2 active')).toHaveTextContent('Filters (2)');

    await setShowAdult(false);
    await advance(0);

    expect(button('Filters, 1 active')).toHaveTextContent('Filters (1)');
    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', minScore: 7, page: 1 },
      expect.any(AbortSignal),
    );
  });

  it('stores the filters applied while off without the adult genre', async () => {
    const { provider, setShowAdult } = await renderScreen(true);
    await applyFilters('Action, not filtered', 'Hentai, not filtered');
    await setShowAdult(false);
    await advance(0);

    await applyFilters('Score 7 or more');
    await setShowAdult(true);
    await advance(0);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', genresIncluded: [1], minScore: 7, page: 1 },
      expect.any(AbortSignal),
    );
  });
});
