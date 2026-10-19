import type { MediaSummary } from '@core/catalog/catalog-provider';
import { englishTitleOf, FORMAT_KEYS, useTranslation, YEAR_FORMAT } from '@core/i18n/index';
import { MediaListItem } from '@ui/index';
import { memo, useCallback } from 'react';

/** the stable list key of a media summary: its media key, `<namespace>:<kind>:<externalId>` */
export const mediaSummaryKey = (item: MediaSummary): string =>
  `${item.key.namespace}:${item.key.kind}:${String(item.key.externalId)}`;

export interface MediaSummaryRowProps {
  item: MediaSummary;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (item: MediaSummary) => void;
  /** the row's testID is `<testIDPrefix>-<namespace>-<kind>-<externalId>` */
  testIDPrefix: string;
}

function MediaSummaryRowView({ item, onOpen, testIDPrefix }: MediaSummaryRowProps) {
  const { t, formatNumber } = useTranslation();
  const open = useCallback(() => {
    onOpen(item);
  }, [onOpen, item]);
  const subtitle = englishTitleOf(item);
  const details = [
    t(FORMAT_KEYS[item.format]),
    ...(item.year === null ? [] : [formatNumber(item.year, YEAR_FORMAT)]),
    ...(item.score === null ? [] : [t('mediaList.score', { score: formatNumber(item.score) })]),
  ];

  return (
    <MediaListItem
      title={item.title}
      {...(subtitle !== undefined && { subtitle })}
      details={details}
      imageUrl={item.imageUrl}
      onPress={open}
      accessibilityHint={t('mediaList.openHint')}
      testID={`${testIDPrefix}-${item.key.namespace}-${item.key.kind}-${String(item.key.externalId)}`}
    />
  );
}

/** a listed title: cover, title, english title, format, year and score; opens its details */
export const MediaSummaryRow = memo(MediaSummaryRowView);
