import type { MediaSummary } from '@core/catalog/catalog-provider';
import { useTranslation } from '@core/i18n/index';
import { MediaListItem } from '@ui/index';
import { memo, useCallback } from 'react';

import { FORMAT_KEYS } from './format-keys';

// a year is written without digit grouping in every language
const YEAR_FORMAT: Intl.NumberFormatOptions = { useGrouping: false };

/** the english title when it says more than the title: present and different ignoring case */
export const englishTitleOf = (item: MediaSummary): string | undefined =>
  item.titleEnglish !== null && item.titleEnglish.toLowerCase() !== item.title.toLowerCase()
    ? item.titleEnglish
    : undefined;

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
