import type { MediaSummary } from '@core/catalog/catalog-provider';
import type { PagedCatalogListResult } from '@core/hooks/use-paged-catalog-list';
import { useTranslation } from '@core/i18n/index';
import { MediaPageList } from '@features/media-list/MediaPageList';
import { useCallback } from 'react';

/** what the discovery screen gives the list of every section */
export interface DiscoveryListProps {
  /** the page requested, 1-based */
  currentPage: number;
  onPageChange: (page: number) => void;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
  /** a key of the list and its page: when it changes, the list starts again at the top */
  scrollToTopKey: string;
}

export interface DiscoveryPageListProps extends DiscoveryListProps {
  /** the page of the section's list, from its hook */
  result: PagedCatalogListResult;
}

/** the page of a discovery section: MediaPageList with the discovery test ids and empty state */
export function DiscoveryPageList({
  result: { query, isPlaceholderFromOtherList },
  currentPage,
  onPageChange,
  onOpen,
  scrollToTopKey,
}: DiscoveryPageListProps) {
  const { t } = useTranslation();
  const { data, error, isFetching, isPlaceholderData, refetch } = query;

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <MediaPageList
      page={data}
      error={error}
      isFetching={isFetching}
      isPlaceholderData={isPlaceholderData}
      isPlaceholderFromOtherList={isPlaceholderFromOtherList}
      onRetry={retry}
      onOpen={onOpen}
      currentPage={currentPage}
      onPageChange={onPageChange}
      scrollToTopKey={scrollToTopKey}
      testIDPrefix="discover"
      emptyTitle={t('discovery.empty.title')}
      emptyMessage={t('discovery.empty.message')}
    />
  );
}
