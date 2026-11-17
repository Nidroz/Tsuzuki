import { SCORE_MAX, type LibraryEntry } from '@core/domain/library-entry';
import { FORMAT_KEYS, PROGRESS_LABEL_KEYS, type Translation } from '@core/i18n/index';

/**
 * the secondary lines of a library entry row, translated and formatted: its format, its progress
 * (of the known total, if any) and its score, when it has one
 */
export const libraryEntryDetails = (
  { t, formatNumber }: Translation,
  entry: LibraryEntry,
): readonly string[] => {
  const progressKeys = PROGRESS_LABEL_KEYS[entry.key.kind];
  const total = entry.media.totalUnits;
  const progress = formatNumber(entry.progress);
  return [
    t(FORMAT_KEYS[entry.media.format]),
    total === null
      ? t(progressKeys.alone, { progress, count: entry.progress })
      : t(progressKeys.ofTotal, { progress, total: formatNumber(total), count: total }),
    ...(entry.score === null
      ? []
      : [
          t('library.list.score', {
            score: formatNumber(entry.score),
            max: formatNumber(SCORE_MAX),
          }),
        ]),
  ];
};
