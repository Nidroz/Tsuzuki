import type { MediaSummary } from '@core/catalog/catalog-provider';
import { CatalogNetworkError } from '@core/errors/catalog-errors';
import type { FilteredPage } from '@core/hooks/filtered-page';
import { useTranslation } from '@core/i18n/index';
import { EmptyState, ErrorState, List, Spinner, Stack, Text } from '@ui/index';
import { useCallback } from 'react';

import { SearchResultRow, searchResultKey } from './SearchResultRow';

export interface SearchResultsProps {
  /** the filtered page of the results shown, undefined until a first page arrives */
  page: FilteredPage<MediaSummary> | undefined;
  error: Error | null;
  /** the page shown belongs to the previous search while the new one loads */
  isPlaceholderData: boolean;
  onRetry: () => void;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
}

/**
 * the results of a search, in this order of precedence: the error with a retry, a spinner on the
 * first load, an empty state when nothing was found, otherwise the list. a note says how many
 * adult titles were hidden (BR-06)
 */
export function SearchResults({
  page,
  error,
  isPlaceholderData,
  onRetry,
  onOpen,
}: SearchResultsProps) {
  const { t } = useTranslation();
  const renderItem = useCallback(
    (item: MediaSummary) => <SearchResultRow item={item} onOpen={onOpen} />,
    [onOpen],
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

  if (page.items.length === 0 && page.hiddenCount === 0) {
    return (
      <EmptyState
        title={t('search.results.empty.title')}
        message={t('search.results.empty.message')}
        testID="search-empty"
      />
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
      testID="search-results"
    />
  );
}
