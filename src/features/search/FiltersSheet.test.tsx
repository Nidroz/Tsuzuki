import type { MediaKind } from '@core/domain/media';
import { EMPTY_SEARCH_FILTERS, type SearchFilters } from '@core/domain/search-filters';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import {
  createStrictFakeCatalogProvider,
  FAKE_SEARCH_GENRES_MAX,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import { advance } from '../../../test/mobile/render-search-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ANIME_GENRES, genresByKind } from './__fixtures__/genres';
import { FiltersSheet } from './FiltersSheet';

const APPLIED: SearchFilters = {
  ...EMPTY_SEARCH_FILTERS,
  format: 'movie',
  yearFrom: 2010,
  minScore: 8,
};

interface Setup {
  readonly visible?: boolean;
  readonly kind?: MediaKind;
  readonly filters?: SearchFilters;
}

const renderSheet = async ({
  visible = true,
  kind = 'anime',
  filters = EMPTY_SEARCH_FILTERS,
}: Setup = {}) => {
  const provider = createStrictFakeCatalogProvider({ getGenres: genresByKind });
  const onApply = jest.fn<(filters: SearchFilters) => void>();
  const onClose = jest.fn();
  const sheet = (open: boolean) => (
    <FiltersSheet
      visible={open}
      kind={kind}
      filters={filters}
      showAdult={false}
      onApply={onApply}
      onClose={onClose}
    />
  );
  const { rerender } = await renderWithProviders(sheet(visible), { catalogProvider: provider });
  await advance(0);
  const setVisible = async (open: boolean) => {
    await rerender(sheet(open));
    await advance(0);
  };
  return { provider, onApply, onClose, setVisible, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });
const radio = (name: string) => screen.getByRole('radio', { name });
const yearField = () => screen.getByTestId('filters-year');
const applyButton = () => screen.getByTestId('filters-apply');

describe('FiltersSheet', () => {
  it('shows its title, a close button, every section, Reset and Apply', async () => {
    const { provider } = await renderSheet();

    expect(screen.getByRole('header', { name: 'Filters' })).toBeOnTheScreen();
    expect(button('Close the filters without applying them')).toBeOnTheScreen();
    for (const title of ['Format', 'Genres', 'Status', 'Minimum score', 'Sort by']) {
      expect(screen.getByText(title)).toBeOnTheScreen();
    }
    expect(yearField()).toHaveAccessibleName('From year');
    expect(button('Reset')).toBeEnabled();
    expect(button('Apply')).toBeEnabled();
    expect(provider.getGenres).toHaveBeenCalledWith('anime', expect.any(AbortSignal));
  });

  it('renders nothing and fetches no genres while closed', async () => {
    const { provider } = await renderSheet({ visible: false });

    expect(screen.queryByTestId('filters-apply')).not.toBeOnTheScreen();
    expect(provider.getGenres).not.toHaveBeenCalled();
  });

  it('starts from the applied filters', async () => {
    await renderSheet({ filters: APPLIED });

    expect(radio('Movie')).toBeChecked();
    expect(radio('Score 8 or more')).toBeChecked();
    expect(radio('Relevance')).toBeChecked();
    expect(yearField()).toHaveProp('value', '2010');
  });

  it('FR-03: applies every edited section at once, then closes', async () => {
    const { onApply, onClose, user } = await renderSheet();

    await user.press(radio('TV'));
    await user.press(button('Action, not filtered'));
    await user.press(button('Adventure, not filtered'));
    await user.press(button('Adventure, included'));
    await user.press(radio('Airing'));
    await user.type(yearField(), '2015');
    await user.press(radio('Score 7 or more'));
    await user.press(radio('Score'));
    await user.press(radio('Ascending'));

    expect(onApply).not.toHaveBeenCalled();

    await user.press(applyButton());

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      format: 'tv',
      genresIncluded: [1],
      genresExcluded: [2],
      status: 'ongoing',
      yearFrom: 2015,
      minScore: 7,
      sort: { field: 'score', direction: 'asc' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('discards the draft on close: reopening starts from the applied filters again', async () => {
    const { onApply, onClose, setVisible, user } = await renderSheet({ filters: APPLIED });
    await user.press(radio('TV'));
    await user.press(radio('Score 8 or more'));
    await user.clear(yearField());

    await user.press(button('Close the filters without applying them'));
    await fireEvent(screen.getByTestId('filters-sheet'), 'requestClose');

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();

    await setVisible(false);
    await setVisible(true);

    expect(radio('Movie')).toBeChecked();
    expect(radio('TV')).not.toBeChecked();
    expect(radio('Score 8 or more')).toBeChecked();
    expect(yearField()).toHaveProp('value', '2010');
  });

  it('resets the draft to no filter, which Apply then commits', async () => {
    const { onApply, user } = await renderSheet({
      filters: { ...APPLIED, genresIncluded: [1], sort: { field: 'title', direction: 'asc' } },
    });

    await user.press(button('Reset'));

    expect(radio('Movie')).not.toBeChecked();
    expect(button('Action, not filtered')).toBeOnTheScreen();
    expect(radio('Relevance')).toBeChecked();
    expect(yearField()).toHaveProp('value', '');
    expect(onApply).not.toHaveBeenCalled();

    await user.press(applyButton());

    expect(onApply).toHaveBeenCalledWith(EMPTY_SEARCH_FILTERS);
  });

  it('disables Apply with an error while the year is invalid; blank clears the year', async () => {
    const { onApply, user } = await renderSheet({ filters: APPLIED });

    await user.clear(yearField());
    await user.type(yearField(), '99');

    expect(screen.getByTestId('filters-year-error')).toHaveTextContent(
      'Enter a year of four digits, from 1000 to 9999.',
    );
    expect(applyButton()).toBeDisabled();

    await user.clear(yearField());

    expect(screen.queryByTestId('filters-year-error')).not.toBeOnTheScreen();
    expect(applyButton()).toBeEnabled();

    await user.press(applyButton());

    expect(onApply).toHaveBeenCalledWith({ ...APPLIED, yearFrom: null });
  });

  it('never fills a genre list beyond the provider limit', async () => {
    const included = ANIME_GENRES.slice(0, FAKE_SEARCH_GENRES_MAX).map((genre) => genre.id);
    const next = ANIME_GENRES[FAKE_SEARCH_GENRES_MAX];
    const { onApply, user } = await renderSheet({
      filters: { ...EMPTY_SEARCH_FILTERS, genresIncluded: included },
    });
    expect(screen.getByTestId('filters-genres-full')).toBeOnTheScreen();

    // the included list is full: a neutral genre goes straight to excluded
    await user.press(button(`${String(next?.name)}, not filtered`));
    await user.press(applyButton());

    expect(onApply).toHaveBeenCalledWith({
      ...EMPTY_SEARCH_FILTERS,
      genresIncluded: included,
      genresExcluded: [next?.id],
    });
  });

  it('offers the manga formats, statuses and genres for manga', async () => {
    const { provider } = await renderSheet({ kind: 'manga' });

    expect(radio('Manhwa')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'TV' })).not.toBeOnTheScreen();
    expect(radio('Publishing')).toBeOnTheScreen();
    expect(button('Isekai, not filtered')).toBeOnTheScreen();
    expect(provider.getGenres).toHaveBeenCalledWith('manga', expect.any(AbortSignal));
  });
});
