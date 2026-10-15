import type { SearchSortField, SortDirection } from '@core/catalog/catalog-provider';
import type { MediaKind, SearchableMediaFormat, SearchableMediaStatus } from '@core/domain/media';
import {
  cycleGenre,
  EMPTY_SEARCH_FILTERS,
  setFormat,
  setMinScore,
  setSortDirection,
  setSortField,
  setStatus,
  setYearFrom,
  type SearchFilters,
} from '@core/domain/search-filters';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { useTranslation } from '@core/i18n/index';
import { isBlankYearInput, parseYearInput } from '@core/schemas/year-input';
import { Button, Row, Sheet } from '@ui/index';
import { useCallback, useState } from 'react';

import { FormatFilter } from './FormatFilter';
import { GenresFilter } from './GenresFilter';
import { MinScoreFilter } from './MinScoreFilter';
import { SortFilter } from './SortFilter';
import { StatusFilter } from './StatusFilter';
import { YearFilter } from './YearFilter';

// what the sheet edits: the filters, and the year field text, which may not be a year yet
interface Draft {
  readonly filters: SearchFilters;
  readonly yearText: string;
}

const draftOf = (filters: SearchFilters): Draft => ({
  filters,
  yearText: filters.yearFrom === null ? '' : String(filters.yearFrom),
});

// blank text clears the year filter; any other invalid text leaves it as it is, Apply disabled
const withYearText = (filters: SearchFilters, text: string): SearchFilters => {
  if (isBlankYearInput(text)) {
    return setYearFrom(filters, null);
  }
  const year = parseYearInput(text);
  return year === null ? filters : setYearFrom(filters, year);
};

const isInvalidYearText = (text: string): boolean =>
  !isBlankYearInput(text) && parseYearInput(text) === null;

export interface FiltersSheetProps {
  visible: boolean;
  kind: MediaKind;
  /** the applied filters: each opening starts a draft from them */
  filters: SearchFilters;
  /** the adult content setting (BR-06): adult genres are hidden when false */
  showAdult: boolean;
  /** commits the draft; the sheet closes right after */
  onApply: (filters: SearchFilters) => void;
  /** closes the sheet; without Apply the draft is discarded */
  onClose: () => void;
}

/**
 * the search filters sheet (FR-03): edits a draft of the applied filters, section by section.
 * Apply commits it and closes, Reset empties it, closing without Apply discards it
 */
export function FiltersSheet({
  visible,
  kind,
  filters,
  showAdult,
  onApply,
  onClose,
}: FiltersSheetProps) {
  const { t } = useTranslation();
  const { searchGenresMax } = useCatalogProvider();
  const [draft, setDraft] = useState(() => draftOf(filters));
  const [wasVisible, setWasVisible] = useState(visible);

  // each opening starts again from the applied filters: what was left unapplied is discarded
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(draftOf(filters));
    }
  }

  const update = useCallback((change: (current: SearchFilters) => SearchFilters) => {
    setDraft((current) => ({ ...current, filters: change(current.filters) }));
  }, []);

  const changeFormat = useCallback(
    (format: SearchableMediaFormat | null) => {
      update((current) => setFormat(current, format));
    },
    [update],
  );
  const cycle = useCallback(
    (genreId: number) => {
      update((current) => cycleGenre(current, genreId, searchGenresMax));
    },
    [update, searchGenresMax],
  );
  const changeStatus = useCallback(
    (status: SearchableMediaStatus | null) => {
      update((current) => setStatus(current, status));
    },
    [update],
  );
  const changeYearText = useCallback((text: string) => {
    setDraft((current) => ({ filters: withYearText(current.filters, text), yearText: text }));
  }, []);
  const changeMinScore = useCallback(
    (minScore: number | null) => {
      update((current) => setMinScore(current, minScore));
    },
    [update],
  );
  const changeSortField = useCallback(
    (field: SearchSortField | null) => {
      update((current) => setSortField(current, field));
    },
    [update],
  );
  const changeSortDirection = useCallback(
    (direction: SortDirection) => {
      update((current) => setSortDirection(current, direction));
    },
    [update],
  );

  const reset = useCallback(() => {
    setDraft(draftOf(EMPTY_SEARCH_FILTERS));
  }, []);
  const apply = () => {
    onApply(draft.filters);
    onClose();
  };

  const yearInvalid = isInvalidYearText(draft.yearText);
  const footer = (
    <Row gap="sm" justify="end">
      <Button
        label={t('search.filters.sheet.reset')}
        variant="secondary"
        onPress={reset}
        testID="filters-reset"
      />
      <Button
        label={t('search.filters.sheet.apply')}
        onPress={apply}
        disabled={yearInvalid}
        testID="filters-apply"
      />
    </Row>
  );

  return (
    <Sheet
      visible={visible}
      title={t('search.filters.sheet.title')}
      closeLabel={t('search.filters.sheet.close')}
      onClose={onClose}
      footer={footer}
      testID="filters-sheet"
    >
      <FormatFilter kind={kind} format={draft.filters.format} onChange={changeFormat} />
      <GenresFilter
        kind={kind}
        filters={draft.filters}
        showAdult={showAdult}
        max={searchGenresMax}
        onCycle={cycle}
      />
      <StatusFilter kind={kind} status={draft.filters.status} onChange={changeStatus} />
      <YearFilter text={draft.yearText} invalid={yearInvalid} onChangeText={changeYearText} />
      <MinScoreFilter minScore={draft.filters.minScore} onChange={changeMinScore} />
      <SortFilter
        sort={draft.filters.sort}
        onFieldChange={changeSortField}
        onDirectionChange={changeSortDirection}
      />
    </Sheet>
  );
}
