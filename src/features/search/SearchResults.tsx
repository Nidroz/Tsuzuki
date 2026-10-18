import type { MediaSummary } from '@core/catalog/catalog-provider';
import { CatalogNetworkError } from '@core/errors/catalog-errors';
import type { FilteredPage } from '@core/hooks/filtered-page';
import { useTranslation } from '@core/i18n/index';
import {
  EmptyState,
  ErrorState,
  List,
  Pagination,
  Spinner,
  Stack,
  Text,
  type PaginationLabels,
} from '@ui/index';
import { useCallback, useMemo } from 'react';

import { SearchResultRow, searchResultKey } from './SearchResultRow';

const FIRST_PAGE = 1;

export interface SearchResultsProps {
  /** the filtered page of the results shown, undefined until a first page arrives */
  page: FilteredPage<MediaSummary> | undefined;
  error: Error | null;
  /** the page shown belongs to the previous search while the new one loads */
  isPlaceholderData: boolean;
  onRetry: () => void;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
  /** the page requested, 1-based: while it loads, the page shown is still the previous one */
  currentPage: number;
  /** called with the page to show, never with the current one */
  onPageChange: (page: number) => void;
  /** a key of the search and its page: when it changes, the list starts again at the top */
  scrollToTopKey: string;
}

/**
 * the results of a search, in this order of precedence: the error with a retry, a spinner on the
 * first load, an empty state when nothing was found, otherwise the list. a note says how many
 * adult titles were hidden (BR-06). the pages (FR-04) follow the list, and the empty state of a
 * page past the first one, so a page past the last stays a way back
 */
export function SearchResults({
  page,
  error,
  isPlaceholderData,
  onRetry,
  onOpen,
  currentPage,
  onPageChange,
  scrollToTopKey,
}: SearchResultsProps) {
  const { t } = useTranslation();
  const renderItem = useCallback(
    (item: MediaSummary) => <SearchResultRow item={item} onOpen={onOpen} />,
    [onOpen],
  );
  const paginationLabels = useMemo<PaginationLabels>(
    () => ({
      previous: t('search.pagination.previous'),
      next: t('search.pagination.next'),
      jumpTo: t('search.pagination.jumpTo'),
      jumpSubmit: t('search.pagination.go'),
      page: (pageNumber) => t('search.pagination.page', { page: pageNumber }),
      currentPage: (pageNumber, pageCount) =>
        t('search.pagination.currentPage', { page: pageNumber, pageCount }),
      ellipsis: t('search.pagination.morePages'),
    }),
    [t],
  );

  if (error !== null) {
    // a network error is most likely the device being offline
    const offline = error instanceof CatalogNetworkError;
    return (
      <ErrorState
        title={offline ? t('search.error.offline.title') : t('search.error.generic.title')}
        message={offline ? t('search.error.offline.message') : t('search.error.generic.message')}
        retry={{ label: t('search.error.retry'), onPress: onRetry }}
        testID="search-error"
      />
    );
  }

  if (page === undefined) {
    return (
      <Stack gap="none" align="center" justify="center" flex>
        <Spinner accessibilityLabel={t('search.results.loading')} testID="search-loading" />
      </Stack>
    );
  }

  // a page requested past the last one stays reachable back from: it counts as a page
  const pagination = (
    <Pagination
      page={currentPage}
      pageCount={Math.max(page.lastPage, currentPage)}
      onPageChange={onPageChange}
      labels={paginationLabels}
      testID="search-pagination"
    />
  );

  if (page.items.length === 0 && page.hiddenCount === 0) {
    const empty = (
      <EmptyState
        title={t('search.results.empty.title')}
        message={t('search.results.empty.message')}
        testID="search-empty"
      />
    );
    // a jikan-compatible instance answers an empty page past the last one
    return currentPage > FIRST_PAGE ? (
      <Stack gap="md" flex>
        {empty}
        {pagination}
      </Stack>
    ) : (
      empty
    );
  }

  const header =
    isPlaceholderData || page.hiddenCount > 0 ? (
      <Stack gap="xs" align="start">
        {isPlaceholderData ? (
          <Spinner
            size="small"
            accessibilityLabel={t('search.results.updating')}
            testID="search-updating"
          />
        ) : null}
        {page.hiddenCount > 0 ? (
          <Text variant="caption" tone="muted" testID="search-hidden-note">
            {t('search.results.hidden', { count: page.hiddenCount })}
          </Text>
        ) : null}
      </Stack>
    ) : null;

  return (
    <List
      items={page.items}
      renderItem={renderItem}
      keyOf={searchResultKey}
      header={header}
      footer={pagination}
      scrollToTopKey={scrollToTopKey}
      testID="search-results"
    />
  );
}
