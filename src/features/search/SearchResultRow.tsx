import type { MediaSummary } from '@core/catalog/catalog-provider';
import { useTranslation } from '@core/i18n/index';
import { englishTitleOf, FORMAT_KEYS, YEAR_FORMAT } from '@features/shared/media-labels';
import { MediaListItem } from '@ui/index';
import { memo, useCallback } from 'react';

/** the stable list key of a search result: its media key */
export const searchResultKey = (item: MediaSummary): string =>
  `${item.key.namespace}:${item.key.kind}:${String(item.key.externalId)}`;

export interface SearchResultRowProps {
  item: MediaSummary;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
}

function SearchResultRowView({ item, onOpen }: SearchResultRowProps) {
  const { t, formatNumber } = useTranslation();
  const open = useCallback(() => {
    onOpen(item);
  }, [onOpen, item]);
  const subtitle = englishTitleOf(item);
  const details = [
    t(FORMAT_KEYS[item.format]),
    ...(item.year === null ? [] : [formatNumber(item.year, YEAR_FORMAT)]),
    ...(item.score === null
      ? []
      : [t('search.results.score', { score: formatNumber(item.score) })]),
  ];

  return (
    <MediaListItem
      title={item.title}
      {...(subtitle !== undefined && { subtitle })}
      details={details}
      imageUrl={item.imageUrl}
      onPress={open}
      accessibilityHint={t('search.results.openHint')}
      testID={`search-result-${item.key.namespace}-${item.key.kind}-${String(item.key.externalId)}`}
    />
  );
}

/** a search result: cover, title, english title, format, year and score; opens its details */
export const SearchResultRow = memo(SearchResultRowView);
