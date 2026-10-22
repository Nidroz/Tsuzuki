import type { MediaSummary } from '@core/catalog/catalog-provider';
import {
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
} from '@core/errors/catalog-errors';
import type { FilteredPage } from '@core/hooks/filtered-page';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import {
  FRIEREN,
  FRIEREN_GOLDEN_LAND,
  filteredPageOf,
} from '../search/__fixtures__/search-results';
import { MediaPageList, type MediaPageListProps } from './MediaPageList';

const HTTP_SERVICE_UNAVAILABLE = 503;
const FRIEREN_ROW = 'search-result-mal-anime-52991';
const GOLDEN_LAND_ROW = 'search-result-mal-anime-63816';
const GENERIC_TITLE = 'Results could not be loaded';

interface ResultsState {
  readonly page?: FilteredPage<MediaSummary>;
  readonly error?: Error;
  readonly isFetching?: boolean;
  readonly isPlaceholderData?: boolean;
  readonly onRetry?: () => void;
  readonly onOpen?: (item: MediaSummary) => void;
  readonly language?: 'en' | 'fr';
}

const propsOf = ({
  page,
  error,
  isFetching = false,
  isPlaceholderData = false,
  onRetry = jest.fn<() => void>(),
  onOpen = jest.fn<(item: MediaSummary) => void>(),
}: ResultsState): MediaPageListProps => ({
  page,
  error: error ?? null,
  isFetching,
  isPlaceholderData,
  isPlaceholderFromOtherList: false,
  onRetry,
  onOpen,
  currentPage: 1,
  onPageChange: jest.fn<(page: number) => void>(),
  scrollToTopKey: 'frieren#1',
  testIDPrefix: 'search',
  emptyTitle: 'No results',
  emptyMessage: 'Try another title, or the other kind.',
});

const renderResults = (state: ResultsState) =>
  renderWithProviders(<MediaPageList {...propsOf(state)} />, { language: state.language ?? 'en' });

describe('MediaPageList', () => {
  it('shows a named spinner until a first page arrives', async () => {
    await renderResults({});

    expect(screen.getByRole('progressbar', { name: 'Loading results' })).toBeOnTheScreen();
    expect(screen.queryByTestId('search-results')).not.toBeOnTheScreen();
  });

  it('lists the visible items in order, each opening itself', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn<(item: MediaSummary) => void>();
    await renderResults({ page: filteredPageOf(0, FRIEREN, FRIEREN_GOLDEN_LAND), onOpen });

    const list = screen.getByTestId('search-results');
    expect(within(list).getAllByRole('button')).toStrictEqual([
      screen.getByTestId(FRIEREN_ROW),
      screen.getByTestId(GOLDEN_LAND_ROW),
    ]);
    expect(screen.queryByTestId('search-hidden-note')).not.toBeOnTheScreen();

    await user.press(screen.getByTestId(GOLDEN_LAND_ROW));

    expect(onOpen).toHaveBeenCalledWith(FRIEREN_GOLDEN_LAND);
  });

  it("shows the screen's empty state on an empty page", async () => {
    await renderResults({ page: filteredPageOf(0) });

    expect(screen.getByTestId('search-empty')).toBeOnTheScreen();
    expect(screen.getByText('No results')).toBeOnTheScreen();
    expect(screen.getByText('Try another title, or the other kind.')).toBeOnTheScreen();
  });

  it.each<[number, string]>([
    [1, '1 adult title was hidden.'],
    [2, '2 adult titles were hidden.'],
  ])('BR-06: notes %i hidden adult title(s) above the visible ones', async (hidden, note) => {
    await renderResults({ page: filteredPageOf(hidden, FRIEREN) });

    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent(note);
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
  });

  it('BR-06: shows the note, not the empty state, when every item was hidden', async () => {
    await renderResults({ page: filteredPageOf(3) });

    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent(
      '3 adult titles were hidden.',
    );
    expect(screen.queryByTestId('search-empty')).not.toBeOnTheScreen();
  });

  it('keeps the previous results with an updating spinner while a new search loads', async () => {
    await renderResults({ page: filteredPageOf(0, FRIEREN), isPlaceholderData: true });

    expect(screen.getByRole('progressbar', { name: 'Updating results' })).toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
  });

  it('shows no pagination for a single page', async () => {
    await renderResults({ page: filteredPageOf(0, FRIEREN, FRIEREN_GOLDEN_LAND) });

    expect(screen.queryByTestId('search-pagination')).not.toBeOnTheScreen();
  });

  it('says the device looks offline on a network error, with a retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn<() => void>();
    await renderResults({ error: new CatalogNetworkError(), onRetry });

    // the container is not an accessible element: role queries miss it (ErrorState.test.tsx)
    expect(screen.getByTestId('search-error')).toHaveProp('accessibilityRole', 'alert');
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    expect(screen.getByText('Check your connection, then try again.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', new CatalogHttpError(HTTP_SERVICE_UNAVAILABLE, null)],
    ['a malformed response', new CatalogResponseError()],
    ['an unknown error', new Error('unknown')],
  ])('shows the generic error for %s', async (_case, error) => {
    await renderResults({ error });

    expect(screen.getByText(GENERIC_TITLE)).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong. Try again in a moment.')).toBeOnTheScreen();
    expect(screen.queryByText('You are offline')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('replaces the error with the spinner while its retry runs, and shows it again on a failure', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn<() => void>();
    const error = new CatalogNetworkError();
    const { rerender } = await renderResults({ error, onRetry });

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);

    await rerender(<MediaPageList {...propsOf({ error, onRetry, isFetching: true })} />);

    expect(screen.getByRole('progressbar', { name: 'Loading results' })).toHaveProp(
      'testID',
      'search-loading',
    );
    expect(screen.queryByTestId('search-error')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();

    await rerender(<MediaPageList {...propsOf({ error, onRetry })} />);

    expect(screen.getByTestId('search-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('search-loading')).not.toBeOnTheScreen();
  });

  it.each([
    ['offline', new CatalogNetworkError(), 'You are offline: this list could not be refreshed.'],
    ['generic', new CatalogResponseError(), 'This list could not be refreshed.'],
  ])(
    'keeps its own page when a refetch fails, with a %s note and a retry',
    async (_case, error, note) => {
      const user = userEvent.setup();
      const onRetry = jest.fn<() => void>();
      await renderResults({ page: filteredPageOf(1, FRIEREN), error, onRetry });

      expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
      expect(screen.getByTestId('search-stale-note')).toHaveTextContent(new RegExp(`^${note}`));
      expect(screen.getByTestId('search-hidden-note')).toBeOnTheScreen();
      expect(screen.queryByTestId('search-error')).not.toBeOnTheScreen();
      expect(screen.queryByTestId('search-updating')).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Try again' }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it('replaces the note with the updating spinner while the retry of its page runs', async () => {
    await renderResults({
      page: filteredPageOf(0, FRIEREN),
      error: new CatalogNetworkError(),
      isFetching: true,
    });

    expect(screen.getByRole('progressbar', { name: 'Updating results' })).toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('search-stale-note')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
  });

  it('notes the failed refetch of its own empty page above the empty state, with a retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn<() => void>();
    await renderResults({ page: filteredPageOf(0), error: new CatalogNetworkError(), onRetry });

    expect(screen.getByTestId('search-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('search-stale-note')).toHaveTextContent(
      /^You are offline: this list could not be refreshed\./,
    );
    expect(screen.queryByTestId('search-error')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the error, not the placeholder page, when the requested page fails', async () => {
    await renderResults({
      page: filteredPageOf(0, FRIEREN),
      error: new CatalogNetworkError(),
      isPlaceholderData: true,
    });

    expect(screen.getByTestId('search-error')).toBeOnTheScreen();
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('search-stale-note')).not.toBeOnTheScreen();
  });

  it('uses the testID prefix for every state and row', async () => {
    await renderWithProviders(
      <MediaPageList
        {...propsOf({ page: filteredPageOf(1, FRIEREN), isPlaceholderData: true })}
        testIDPrefix="discover"
      />,
    );

    expect(screen.getByTestId('discover-results')).toBeOnTheScreen();
    expect(screen.getByTestId('discover-updating')).toBeOnTheScreen();
    expect(screen.getByTestId('discover-hidden-note')).toBeOnTheScreen();
    expect(screen.getByTestId('discover-result-mal-anime-52991')).toBeOnTheScreen();
  });

  it('is translated in french', async () => {
    await renderResults({ page: filteredPageOf(2, FRIEREN), language: 'fr' });

    expect(screen.getByTestId('search-hidden-note')).toHaveTextContent(
      '2 titres pour adultes ont été masqués.',
    );
  });

  it('shows the offline error in french', async () => {
    await renderResults({ error: new CatalogNetworkError(), language: 'fr' });

    expect(screen.getByText('Vous êtes hors ligne')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeOnTheScreen();
  });

  it('notes a failed refetch in french', async () => {
    await renderResults({
      page: filteredPageOf(0, FRIEREN),
      error: new CatalogNetworkError(),
      language: 'fr',
    });

    expect(screen.getByTestId('search-stale-note')).toHaveTextContent(
      /^Vous êtes hors ligne : cette liste n'a pas pu être actualisée\./,
    );
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeOnTheScreen();
  });
});
