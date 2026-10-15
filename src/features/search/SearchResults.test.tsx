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
import { FRIEREN, FRIEREN_GOLDEN_LAND, filteredPageOf } from './__fixtures__/search-results';
import { SearchResults } from './SearchResults';

const HTTP_SERVICE_UNAVAILABLE = 503;
const FRIEREN_ROW = 'search-result-mal-anime-52991';
const GOLDEN_LAND_ROW = 'search-result-mal-anime-63816';

interface ResultsState {
  readonly page?: FilteredPage<MediaSummary>;
  readonly error?: Error;
  readonly isPlaceholderData?: boolean;
  readonly onRetry?: () => void;
  readonly onOpen?: (item: MediaSummary) => void;
  readonly language?: 'en' | 'fr';
}

const renderResults = ({
  page,
  error,
  isPlaceholderData = false,
  onRetry = jest.fn<() => void>(),
  onOpen = jest.fn<(item: MediaSummary) => void>(),
  language = 'en',
}: ResultsState) =>
  renderWithProviders(
    <SearchResults
      page={page}
      error={error ?? null}
      isPlaceholderData={isPlaceholderData}
      onRetry={onRetry}
      onOpen={onOpen}
    />,
    { language },
  );

describe('SearchResults', () => {
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

  it('says that nothing was found on an empty page', async () => {
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

  it('says the device looks offline on a network error, with a retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn<() => void>();
    await renderResults({
      page: filteredPageOf(0, FRIEREN),
      error: new CatalogNetworkError(),
      onRetry,
    });

    // the container is not an accessible element: role queries miss it (ErrorState.test.tsx)
    expect(screen.getByTestId('search-error')).toHaveProp('accessibilityRole', 'alert');
    expect(screen.getByText('You are offline')).toBeOnTheScreen();
    expect(screen.getByText('Check your connection, then try again.')).toBeOnTheScreen();
    // the error wins over the results kept from before
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', new CatalogHttpError(HTTP_SERVICE_UNAVAILABLE, null)],
    ['a malformed response', new CatalogResponseError()],
    ['an unknown error', new Error('unknown')],
  ])('shows the generic error for %s', async (_case, error) => {
    await renderResults({ error });

    expect(screen.getByText('Search failed')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong. Try again in a moment.')).toBeOnTheScreen();
    expect(screen.queryByText('You are offline')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
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
});
