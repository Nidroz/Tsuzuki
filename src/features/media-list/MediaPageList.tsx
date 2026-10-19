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
import { useCallback, useMemo, type ReactElement } from 'react';

import { MediaSummaryRow, mediaSummaryKey } from './MediaSummaryRow';

const FIRST_PAGE = 1;

export interface MediaPageListProps {
  /** the filtered page shown, undefined until a first page arrives */
  page: FilteredPage<MediaSummary> | undefined;
  error: Error | null;
  /** a request runs: after an error, its retry */
  isFetching: boolean;
  /** the page shown belongs to another key while the requested one loads */
  isPlaceholderData: boolean;
  /** the page shown belongs to another list (the search before): its last page is not this list's */
  isPlaceholderFromOtherList: boolean;
  onRetry: () => void;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
  /** the page requested, 1-based: while it loads, the page shown is still the previous one */
  currentPage: number;
  /** called with the page to show, never with the current one */
  onPageChange: (page: number) => void;
  /** a key of the list and its page: when it changes, the list starts again at the top */
  scrollToTopKey: string;
  /**
   * the prefix of the testIDs: `<prefix>-error`, `-loading`, `-empty`, `-results`, `-updating`,
   * `-hidden-note`, `-pagination`, and `<prefix>-result` for the rows
   */
  testIDPrefix: string;
  /** the translated empty state of the screen */
  emptyTitle: string;
  emptyMessage: string;
}

/**
 * one page of a catalog list, in this order of precedence: the loading spinner while the retry of
 * an error runs, the error with a retry, a spinner on the first load, an empty state when nothing
 * was found, otherwise the list. a note says how many adult titles were hidden (BR-06). the pages
 * (FR-04) follow the list, and the empty state, the error or its retry on a page past the first
 * one, so a page past the last or a failed page stays a way back
 */
export function MediaPageList({
  page,
  error,
  isFetching,
  isPlaceholderData,
  isPlaceholderFromOtherList,
  onRetry,
  onOpen,
  currentPage,
  onPageChange,
  scrollToTopKey,
  testIDPrefix,
  emptyTitle,
  emptyMessage,
}: MediaPageListProps) {
  const { t } = useTranslation();
  const rowPrefix = `${testIDPrefix}-result`;
  const renderItem = useCallback(
    (item: MediaSummary) => (
      <MediaSummaryRow item={item} onOpen={onOpen} testIDPrefix={rowPrefix} />
    ),
    [onOpen, rowPrefix],
  );
  const paginationLabels = useMemo<PaginationLabels>(
    () => ({
      previous: t('mediaList.pagination.previous'),
      next: t('mediaList.pagination.next'),
      jumpTo: t('mediaList.pagination.jumpTo'),
      jumpSubmit: t('mediaList.pagination.go'),
      page: (pageNumber) => t('mediaList.pagination.page', { page: pageNumber }),
      currentPage: (pageNumber, pageCount) =>
        t('mediaList.pagination.currentPage', { page: pageNumber, pageCount }),
      ellipsis: t('mediaList.pagination.morePages'),
    }),
    [t],
  );

  // a requested page past the last one stays reachable back from: it counts as a page. the last
  // page of another list says nothing of this one: only the requested page is known then
  const pageCount =
    page === undefined || isPlaceholderFromOtherList
      ? currentPage
      : Math.max(page.lastPage, currentPage);
  const pagination = (
    <Pagination
      page={currentPage}
      pageCount={pageCount}
      onPageChange={onPageChange}
      labels={paginationLabels}
      testID={`${testIDPrefix}-pagination`}
    />
  );
  // a state replacing the list keeps the pages under it past the first page
  const withPagination = (state: ReactElement) =>
    currentPage > FIRST_PAGE ? (
      <Stack gap="md" flex>
        {state}
        {pagination}
      </Stack>
    ) : (
      state
    );
  const loading = (
    <Stack gap="none" align="center" justify="center" flex>
      <Spinner accessibilityLabel={t('mediaList.loading')} testID={`${testIDPrefix}-loading`} />
    </Stack>
  );

  if (error !== null) {
    // the retry runs: a spinner, so a tap never cancels and restarts the request
    if (isFetching) {
      return withPagination(loading);
    }
    // a network error is most likely the device being offline
    const offline = error instanceof CatalogNetworkError;
    return withPagination(
      <ErrorState
        title={offline ? t('mediaList.error.offline.title') : t('mediaList.error.generic.title')}
        message={
          offline ? t('mediaList.error.offline.message') : t('mediaList.error.generic.message')
        }
        retry={{ label: t('mediaList.error.retry'), onPress: onRetry }}
        testID={`${testIDPrefix}-error`}
      />,
    );
  }

  if (page === undefined) {
    return loading;
  }

  if (page.items.length === 0 && page.hiddenCount === 0) {
    // a jikan-compatible instance answers an empty page past the last one
    return withPagination(
      <EmptyState title={emptyTitle} message={emptyMessage} testID={`${testIDPrefix}-empty`} />,
    );
  }

  const header =
    isPlaceholderData || page.hiddenCount > 0 ? (
      <Stack gap="xs" align="start">
        {isPlaceholderData ? (
          <Spinner
            size="small"
            accessibilityLabel={t('mediaList.updating')}
            testID={`${testIDPrefix}-updating`}
          />
        ) : null}
        {page.hiddenCount > 0 ? (
          <Text variant="caption" tone="muted" testID={`${testIDPrefix}-hidden-note`}>
            {t('mediaList.hidden', { count: page.hiddenCount })}
          </Text>
        ) : null}
      </Stack>
    ) : null;

  return (
    <List
      items={page.items}
      renderItem={renderItem}
      keyOf={mediaSummaryKey}
      header={header}
      footer={pagination}
      scrollToTopKey={scrollToTopKey}
      testID={`${testIDPrefix}-results`}
    />
  );
}
