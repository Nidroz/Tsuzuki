import type { MediaSummary } from '@core/catalog/catalog-provider';
import { CatalogNetworkError } from '@core/errors/catalog-errors';
import type { FilteredPage } from '@core/hooks/filtered-page';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN, FRIEREN_GOLDEN_LAND, filteredPageOf } from './__fixtures__/search-results';
import { SearchResults } from './SearchResults';

// the pages of the results (FR-04, C-06); the other states are tested in SearchResults.test.tsx

const LAST_PAGE = 3;
const PAGINATION = 'search-pagination';

// the requested page of a search of `lastPage` pages
const pageOfMany = (
  page: number,
  lastPage: number,
  ...items: MediaSummary[]
): FilteredPage<MediaSummary> => ({
  ...filteredPageOf(0, ...items),
  page,
  lastPage,
  hasNextPage: page < lastPage,
});

interface PaginationState {
  readonly page?: FilteredPage<MediaSummary>;
  readonly error?: Error;
  readonly currentPage: number;
  readonly language?: 'en' | 'fr';
}

const renderResults = async ({ page, error, currentPage, language = 'en' }: PaginationState) => {
  const onPageChange = jest.fn<(page: number) => void>();
  await renderWithProviders(
    <SearchResults
      page={page}
      error={error ?? null}
      isPlaceholderData={false}
      onRetry={jest.fn<() => void>()}
      onOpen={jest.fn<(item: MediaSummary) => void>()}
      currentPage={currentPage}
      onPageChange={onPageChange}
      scrollToTopKey={`frieren#${String(currentPage)}`}
    />,
    { language },
  );
  return { onPageChange };
};

describe('SearchResults pagination (FR-04)', () => {
  it('follows the results with labelled pages, the requested one current', async () => {
    await renderResults({
      page: pageOfMany(2, LAST_PAGE, FRIEREN, FRIEREN_GOLDEN_LAND),
      currentPage: 2,
    });

    const list = screen.getByTestId('search-results');
    const pagination = within(list).getByTestId(PAGINATION);
    expect(within(pagination).getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeEnabled();
    expect(within(pagination).getByRole('button', { name: 'Page 1' })).toBeOnTheScreen();
    expect(
      within(pagination).getByRole('button', { name: 'Page 2 of 3, current page' }),
    ).toBeOnTheScreen();
    expect(within(pagination).getByLabelText('Go to page')).toBeOnTheScreen();
    expect(within(pagination).getByRole('button', { name: 'Go' })).toBeOnTheScreen();
  });

  it('requests the next, the previous, a picked and a typed page', async () => {
    const user = userEvent.setup();
    const { onPageChange } = await renderResults({
      page: pageOfMany(2, LAST_PAGE, FRIEREN),
      currentPage: 2,
    });

    await user.press(screen.getByRole('button', { name: 'Next page' }));
    await user.press(screen.getByRole('button', { name: 'Previous page' }));
    await user.press(screen.getByRole('button', { name: 'Page 3' }));
    await user.type(screen.getByLabelText('Go to page'), '1', { submitEditing: true });

    expect(onPageChange.mock.calls).toStrictEqual([[3], [1], [3], [1]]);
  });

  it('keeps a requested page past the last one, empty, with the way back under it', async () => {
    const user = userEvent.setup();
    const pastTheLast = LAST_PAGE + 2;
    const { onPageChange } = await renderResults({
      page: pageOfMany(pastTheLast, LAST_PAGE),
      currentPage: pastTheLast,
    });

    expect(screen.getByTestId('search-empty')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Page 5 of 5, current page' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Page 1' }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('shows no pages under an empty first page', async () => {
    await renderResults({ page: pageOfMany(1, LAST_PAGE), currentPage: 1 });
    expect(screen.getByTestId('search-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId(PAGINATION)).not.toBeOnTheScreen();
  });

  it.each([
    ['an error', { error: new CatalogNetworkError(), currentPage: 2 }],
    ['the first-load spinner', { currentPage: 2 }],
  ])('shows no pages with %s', async (_case, state) => {
    await renderResults(state);

    expect(screen.queryByTestId(PAGINATION)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeOnTheScreen();
  });

  it('labels the pages in french', async () => {
    await renderResults({
      page: pageOfMany(1, LAST_PAGE, FRIEREN),
      currentPage: 1,
      language: 'fr',
    });

    expect(screen.getByRole('button', { name: 'Page suivante' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Page précédente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Page 1 sur 3, page actuelle' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Page 2' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Aller à la page')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Aller' })).toBeOnTheScreen();
  });
});
