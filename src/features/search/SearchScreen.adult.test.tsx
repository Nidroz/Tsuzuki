import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import { advance, renderSearchScreen } from '../../../test/mobile/render-search-screen';
import { genresByKind } from './__fixtures__/genres';
import { adultItem, FRIEREN, pageOf } from './__fixtures__/search-results';

// bR-06, FR-03, FR-32, ADR-0004: the adult content setting on the search screen. it never changes
// a request: the applied filters are searched as they are, an adult genre included, the adult
// results hidden client-side while it is off, so toggling it never searches again

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

  it('shows the adult results while on, hides and counts them while off, without searching again', async () => {
    const { provider, setShowAdult } = await renderScreen(true);
    await applyFilters('Score 7 or more');
    const calls = provider.search.mock.calls.length;

    expect(screen.getByTestId(ADULT_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('search-hidden-note')).not.toBeOnTheScreen();

    await setShowAdult(false);
    await advance(0);

    expect(screen.queryByTestId(ADULT_ROW)).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent('1 adult title was hidden.');
    expect(provider.search).toHaveBeenCalledTimes(calls);
  });

  it('keeps searching an included adult genre while off, and toggling never searches again', async () => {
    const { provider, setShowAdult } = await renderScreen(true, answersByGenre);
    await applyFilters('Action, not filtered', 'Hentai, not filtered');
    const calls = provider.search.mock.calls.length;
    const searched = { kind: 'anime', genresIncluded: [1, HENTAI_ID], page: 1 };

    expect(provider.search).toHaveBeenLastCalledWith(searched, expect.any(AbortSignal));

    await setShowAdult(false);
    await advance(0);

    // the same search, its adult result hidden with the note, the adult genre still counted
    expect(provider.search).toHaveBeenCalledTimes(calls);
    expect(screen.queryByTestId(ADULT_ROW)).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent('1 adult title was hidden.');
    expect(button('Filters, 1 active')).toBeOnTheScreen();

    await setShowAdult(true);
    await advance(0);

    expect(provider.search).toHaveBeenCalledTimes(calls);
    expect(provider.search).toHaveBeenLastCalledWith(searched, expect.any(AbortSignal));
    expect(screen.getByTestId(ADULT_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('search-hidden-note')).not.toBeOnTheScreen();
  });

  it('keeps searching an excluded adult genre while off, still counted', async () => {
    const { provider, setShowAdult } = await renderScreen(true);
    await applyFilters('Erotica, not filtered', 'Erotica, included', 'Score 7 or more');
    const calls = provider.search.mock.calls.length;
    expect(button('Filters, 2 active')).toHaveTextContent('Filters (2)');

    await setShowAdult(false);
    await advance(0);

    expect(button('Filters, 2 active')).toHaveTextContent('Filters (2)');
    expect(provider.search).toHaveBeenCalledTimes(calls);
    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', genresExcluded: [49], minScore: 7, page: 1 },
      expect.any(AbortSignal),
    );
  });

  it('shows an applied adult genre in the sheet while off, until it is removed and applied', async () => {
    const { provider, setShowAdult } = await renderScreen(true, answersByGenre);
    await applyFilters('Action, not filtered', 'Hentai, not filtered');
    await setShowAdult(false);
    await advance(0);

    await user.press(screen.getByTestId('search-filters'));
    await advance(0);
    // the applied adult genre shows to be removed; the other adult genre stays hidden
    await user.press(control('Hentai, included'));
    await user.press(control('Hentai, excluded'));
    // back to neutral, it stays until the sheet closes: no chip moves under a tap
    expect(control('Hentai, not filtered')).toBeOnTheScreen();
    expect(screen.queryByTestId('filters-genre-49')).not.toBeOnTheScreen();
    await user.press(screen.getByTestId('filters-apply'));
    await advance(0);

    expect(provider.search).toHaveBeenLastCalledWith(
      { kind: 'anime', genresIncluded: [1], page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.queryByTestId('search-hidden-note')).not.toBeOnTheScreen();

    // applied without it, the next opening hides it again
    await user.press(screen.getByTestId('search-filters'));
    await advance(0);

    expect(screen.queryByTestId(`filters-genre-${String(HENTAI_ID)}`)).not.toBeOnTheScreen();
    expect(control('Action, included')).toBeOnTheScreen();
  });
});
