import type { MediaSummary } from '@core/catalog/catalog-provider';
import type { MediaFormat } from '@core/domain/media';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { MediaListItem } from '@ui/index';
import { memo, useCallback } from 'react';

const FORMAT_KEYS = {
  tv: 'media.format.tv',
  movie: 'media.format.movie',
  ova: 'media.format.ova',
  ona: 'media.format.ona',
  special: 'media.format.special',
  music: 'media.format.music',
  manga: 'media.format.manga',
  manhwa: 'media.format.manhwa',
  manhua: 'media.format.manhua',
  light_novel: 'media.format.light_novel',
  novel: 'media.format.novel',
  one_shot: 'media.format.one_shot',
  doujinshi: 'media.format.doujinshi',
  oel: 'media.format.oel',
  unknown: 'media.format.unknown',
} as const satisfies Record<MediaFormat, TranslationKey>;

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
