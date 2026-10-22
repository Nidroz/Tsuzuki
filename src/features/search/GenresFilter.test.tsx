import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { EMPTY_SEARCH_FILTERS, type SearchFilters } from '@core/domain/search-filters';
import { CatalogNetworkError } from '@core/errors/catalog-errors';
import { createQueryClient } from '@core/query/query-client';
import type { Language } from '@core/i18n/index';
import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';

import {
  createStrictFakeCatalogProvider,
  FAKE_SEARCH_GENRES_MAX,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import { advance } from '../../../test/mobile/render-search-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ADULT_GENRE_IDS, ANIME_GENRES, genresByKind } from './__fixtures__/genres';
import { GenresFilter } from './GenresFilter';

interface Setup {
  readonly filters?: SearchFilters;
  readonly appliedFilters?: SearchFilters;
  readonly showAdult?: boolean;
  readonly getGenres?: CatalogProvider['getGenres'];
  readonly language?: Language;
  readonly queryClient?: QueryClient;
}

const renderGenres = async ({
  filters = EMPTY_SEARCH_FILTERS,
  appliedFilters = EMPTY_SEARCH_FILTERS,
  showAdult = false,
  getGenres = genresByKind,
  language = 'en',
  queryClient = createQueryClient(),
}: Setup = {}) => {
  const provider = createStrictFakeCatalogProvider({ getGenres });
  const onCycle = jest.fn<(genreId: number) => void>();
  await renderWithProviders(
    <GenresFilter
      kind="anime"
      filters={filters}
      appliedFilters={appliedFilters}
      showAdult={showAdult}
      max={FAKE_SEARCH_GENRES_MAX}
      onCycle={onCycle}
    />,
    { catalogProvider: provider, language, queryClient },
  );
  await advance(0);
  return { provider, onCycle };
};

const MAX = FAKE_SEARCH_GENRES_MAX;
// the adult genres of ANIME_GENRES
const HENTAI_ID = 12;
const EROTICA_ID = 49;

const ids = (count: number) => ANIME_GENRES.slice(0, count).map((genre) => genre.id);

describe('GenresFilter', () => {
  it('shows a spinner while the genres load', async () => {
    await renderGenres({ getGenres: () => new Promise(() => undefined) });

    expect(screen.getByRole('progressbar', { name: 'Loading genres' })).toBeOnTheScreen();
    expect(screen.getByText('Genres')).toBeOnTheScreen();
  });

  it('shows a chip per genre of the kind, each named with its state', async () => {
    const { provider } = await renderGenres({
      filters: { ...EMPTY_SEARCH_FILTERS, genresIncluded: [1], genresExcluded: [2] },
    });

    expect(provider.getGenres).toHaveBeenCalledWith('anime', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Action, included' })).toBeSelected();
    const excluded = screen.getByRole('button', { name: 'Adventure, excluded' });
    expect(excluded).not.toBeSelected();
    expect(excluded).toHaveTextContent(/Adventure/);
    expect(screen.getByRole('button', { name: 'Comedy, not filtered' })).not.toBeSelected();
  });

  it('cycles the pressed genre', async () => {
    const user = userEvent.setup();
    const { onCycle } = await renderGenres();

    await user.press(screen.getByRole('button', { name: 'Fantasy, not filtered' }));

    expect(onCycle).toHaveBeenCalledWith(10);
  });

  it('BR-06: hides the neutral adult genres while adult content is off', async () => {
    await renderGenres();

    for (const id of ADULT_GENRE_IDS) {
      expect(screen.queryByTestId(`filters-genre-${String(id)}`)).not.toBeOnTheScreen();
    }
    expect(screen.queryByText('Hentai')).not.toBeOnTheScreen();
    expect(screen.getByText('Action')).toBeOnTheScreen();
  });

  it('BR-06: shows the adult genres the draft includes or excludes while adult content is off', async () => {
    await renderGenres({
      filters: {
        ...EMPTY_SEARCH_FILTERS,
        genresIncluded: [HENTAI_ID],
        genresExcluded: [EROTICA_ID],
      },
    });

    expect(screen.getByRole('button', { name: 'Hentai, included' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Erotica, excluded' })).toBeOnTheScreen();
  });

  it('BR-06: keeps an applied adult genre shown once the draft has it neutral again, until the sheet closes', async () => {
    const applied = { ...EMPTY_SEARCH_FILTERS, genresIncluded: [HENTAI_ID] };
    await renderGenres({ filters: EMPTY_SEARCH_FILTERS, appliedFilters: applied });

    expect(screen.getByRole('button', { name: 'Hentai, not filtered' })).toBeOnTheScreen();
    expect(screen.queryByTestId(`filters-genre-${String(EROTICA_ID)}`)).not.toBeOnTheScreen();
  });

  it('BR-06: cycles a shown adult genre like any other', async () => {
    const user = userEvent.setup();
    const { onCycle } = await renderGenres({
      filters: { ...EMPTY_SEARCH_FILTERS, genresExcluded: [HENTAI_ID] },
    });

    await user.press(screen.getByRole('button', { name: 'Hentai, excluded' }));

    expect(onCycle).toHaveBeenCalledWith(HENTAI_ID);
  });

  it('BR-06: shows every adult genre while adult content is on', async () => {
    await renderGenres({
      showAdult: true,
      filters: { ...EMPTY_SEARCH_FILTERS, genresIncluded: [HENTAI_ID] },
    });

    expect(screen.getByRole('button', { name: 'Hentai, included' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Erotica, not filtered' })).toBeOnTheScreen();
  });

  it('has no full-list note while both lists have room', async () => {
    await renderGenres({ filters: { ...EMPTY_SEARCH_FILTERS, genresIncluded: ids(MAX - 1) } });

    expect(screen.queryByTestId('filters-genres-full')).not.toBeOnTheScreen();
  });

  it.each<[string, SearchFilters]>([
    ['included', { ...EMPTY_SEARCH_FILTERS, genresIncluded: ids(MAX) }],
    ['excluded', { ...EMPTY_SEARCH_FILTERS, genresExcluded: ids(MAX) }],
  ])('says when the %s list is full', async (_list, filters) => {
    await renderGenres({ filters });

    expect(screen.getByTestId('filters-genres-full')).toHaveTextContent(
      `At most ${String(MAX)} genres can be included, and ${String(MAX)} excluded.`,
    );
  });

  it('shows an error with a retry that fetches the genres again', async () => {
    const user = userEvent.setup();
    const getGenres = jest
      .fn<CatalogProvider['getGenres']>()
      .mockRejectedValueOnce(new CatalogNetworkError())
      .mockImplementation(genresByKind);
    const { provider } = await renderGenres({ getGenres });

    expect(screen.getByText('Genres could not be loaded')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);

    expect(provider.getGenres).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('filters-genres-error')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Action, not filtered' })).toBeOnTheScreen();
  });

  it('replaces the error with the spinner while the retry runs, and shows it again on a failure', async () => {
    const user = userEvent.setup();
    let failRetry: () => void = () => undefined;
    const getGenres = jest
      .fn<CatalogProvider['getGenres']>()
      .mockRejectedValueOnce(new CatalogNetworkError())
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            failRetry = () => {
              reject(new CatalogNetworkError());
            };
          }),
      );
    await renderGenres({ getGenres });
    expect(screen.getByTestId('filters-genres-error')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);

    expect(screen.getByRole('progressbar', { name: 'Loading genres' })).toBeOnTheScreen();
    expect(screen.queryByTestId('filters-genres-error')).not.toBeOnTheScreen();

    failRetry();
    await advance(0);

    expect(screen.getByTestId('filters-genres-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('filters-genres-loading')).not.toBeOnTheScreen();
    expect(getGenres).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached genres when a refetch fails', async () => {
    const queryClient = createQueryClient();
    const getGenres = jest
      .fn<CatalogProvider['getGenres']>()
      .mockImplementationOnce(genresByKind)
      .mockRejectedValue(new CatalogNetworkError());
    await renderGenres({ getGenres, queryClient });

    await act(() => queryClient.refetchQueries());

    expect(getGenres).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('filters-genres-error')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Action, not filtered' })).toBeOnTheScreen();
  });

  it('says when there is no genre to show', async () => {
    await renderGenres({ getGenres: () => Promise.resolve([]) });

    expect(screen.getByTestId('filters-genres-empty')).toHaveTextContent('No genres to filter on.');
  });

  it('names the states in french', async () => {
    await renderGenres({
      filters: { ...EMPTY_SEARCH_FILTERS, genresIncluded: [1], genresExcluded: [2] },
      language: 'fr',
    });

    expect(screen.getByRole('button', { name: 'Action, inclus' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Adventure, exclu' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Comedy, non filtré' })).toBeOnTheScreen();
  });
});
