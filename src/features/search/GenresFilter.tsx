import type { Genre } from '@core/catalog/catalog-provider';
import { isAdultGenreName } from '@core/domain/content-filter';
import type { MediaKind } from '@core/domain/media';
import {
  genreFilterState,
  type GenreFilterState,
  type SearchFilters,
} from '@core/domain/search-filters';
import { useGenres } from '@core/hooks/use-genres';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { Chip, ErrorState, Row, Spinner, Stack, Text } from '@ui/index';
import { memo, useCallback, useMemo } from 'react';

// the accessibility label of a genre chip names its state, which the chip shows by its look
const STATE_KEYS = {
  neutral: 'search.filters.genres.neutral',
  included: 'search.filters.genres.included',
  excluded: 'search.filters.genres.excluded',
} as const satisfies Record<GenreFilterState, TranslationKey>;

interface GenreChipProps {
  genre: Genre;
  state: GenreFilterState;
  /** pass a stable function: a new one re-renders every chip */
  onCycle: (genreId: number) => void;
}

// a genre the filters include or exclude
const isFiltered = (filters: SearchFilters, genreId: number): boolean =>
  genreFilterState(filters, genreId) !== 'neutral';

const GenreChip = memo(function GenreChip({ genre, state, onCycle }: GenreChipProps) {
  const { t } = useTranslation();
  const cycle = useCallback(() => {
    onCycle(genre.id);
  }, [onCycle, genre.id]);

  return (
    <Chip
      label={genre.name}
      accessibilityLabel={t(STATE_KEYS[state], { name: genre.name })}
      selected={state === 'included'}
      excluded={state === 'excluded'}
      onPress={cycle}
      testID={`filters-genre-${String(genre.id)}`}
    />
  );
});

export interface GenresFilterProps {
  kind: MediaKind;
  /** the draft filters: their genre lists give each chip its state */
  filters: SearchFilters;
  /** the applied filters the draft started from: they keep their adult genres shown (BR-06) */
  appliedFilters: SearchFilters;
  /** the adult content setting (BR-06): neutral adult genres are hidden when false */
  showAdult: boolean;
  /** the most genre ids of each list (CatalogProvider.searchGenresMax) */
  max: number;
  /** moves a genre to its next state; pass a stable function */
  onCycle: (genreId: number) => void;
}

/**
 * the genres section of the filters sheet (FR-03): one chip per genre of the kind, each cycling
 * neutral -> included -> excluded; a note says when a list is full. while adult content is off
 * (BR-06), an adult genre is hidden unless the draft or the applied filters include or exclude it:
 * an adult genre applied while the setting was on stays searched (the setting never changes a
 * request), so its chip shows to let it be removed, and stays until the sheet closes, even once
 * back to neutral, so no chip moves under a tap
 */
export function GenresFilter({
  kind,
  filters,
  appliedFilters,
  showAdult,
  max,
  onCycle,
}: GenresFilterProps) {
  const { t } = useTranslation();
  const { data, error, isFetching, refetch } = useGenres(kind);
  const genres = useMemo(
    () =>
      data?.filter(
        (genre) =>
          showAdult ||
          !isAdultGenreName(genre.name) ||
          isFiltered(filters, genre.id) ||
          isFiltered(appliedFilters, genre.id),
      ),
    [data, showAdult, filters, appliedFilters],
  );
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const full = filters.genresIncluded.length >= max || filters.genresExcluded.length >= max;

  const content = () => {
    // a failed background refetch keeps the cached genres usable: the error shows only without
    // them, and the spinner replaces it while its retry runs, so a tap never restarts the request
    if (error !== null && genres === undefined && !isFetching) {
      return (
        <ErrorState
          title={t('search.filters.genres.error')}
          retry={{ label: t('search.filters.genres.retry'), onPress: retry }}
          testID="filters-genres-error"
        />
      );
    }
    if (genres === undefined) {
      return (
        <Stack gap="none" align="start">
          <Spinner
            size="small"
            accessibilityLabel={t('search.filters.genres.loading')}
            testID="filters-genres-loading"
          />
        </Stack>
      );
    }
    if (genres.length === 0) {
      return (
        <Text tone="muted" testID="filters-genres-empty">
          {t('search.filters.genres.empty')}
        </Text>
      );
    }
    return (
      <>
        <Text variant="caption" tone="muted">
          {t('search.filters.genres.hint')}
        </Text>
        {full ? (
          <Text variant="caption" tone="muted" testID="filters-genres-full">
            {t('search.filters.genres.full', { max })}
          </Text>
        ) : null}
        <Row gap="sm" wrap>
          {genres.map((genre) => (
            <GenreChip
              key={genre.id}
              genre={genre}
              state={genreFilterState(filters, genre.id)}
              onCycle={onCycle}
            />
          ))}
        </Row>
      </>
    );
  };

  return (
    <Stack gap="sm" testID="filters-genres">
      <Text variant="subtitle">{t('search.filters.genres.title')}</Text>
      {content()}
    </Stack>
  );
}
