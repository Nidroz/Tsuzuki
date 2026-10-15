import {
  SEARCH_SORT_FIELDS,
  SORT_DIRECTIONS,
  type SearchSortField,
  type SortDirection,
} from '@core/catalog/catalog-provider';
import type { SearchSort } from '@core/domain/search-filters';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { Stack } from '@ui/index';
import { useCallback, useMemo } from 'react';

import { FilterChoice, type FilterChoiceOption } from './FilterChoice';

// a function, not a lookup object: the sort field named title would read as a text key
const fieldKey = (field: SearchSortField) => `search.filters.sort.field.${field}` as const;

const DIRECTION_KEYS = {
  asc: 'search.filters.sort.direction.asc',
  desc: 'search.filters.sort.direction.desc',
} as const satisfies Record<SortDirection, TranslationKey>;

export interface SortFilterProps {
  /** null: the provider relevance order */
  sort: SearchSort | null;
  onFieldChange: (field: SearchSortField | null) => void;
  onDirectionChange: (direction: SortDirection) => void;
}

/**
 * the sort section of the filters sheet: relevance or a field, then the direction of the chosen
 * field, shown only once a field is chosen
 */
export function SortFilter({ sort, onFieldChange, onDirectionChange }: SortFilterProps) {
  const { t } = useTranslation();
  const fields = useMemo<readonly FilterChoiceOption<SearchSortField>[]>(
    () => SEARCH_SORT_FIELDS.map((value) => ({ value, label: t(fieldKey(value)) })),
    [t],
  );
  const directions = useMemo<readonly FilterChoiceOption<SortDirection>[]>(
    () => SORT_DIRECTIONS.map((value) => ({ value, label: t(DIRECTION_KEYS[value]) })),
    [t],
  );
  // the direction chips are not deselectable: they never give null
  const changeDirection = useCallback(
    (direction: SortDirection | null) => {
      if (direction !== null) {
        onDirectionChange(direction);
      }
    },
    [onDirectionChange],
  );

  return (
    <Stack gap="md">
      <FilterChoice
        title={t('search.filters.sort.title')}
        options={fields}
        value={sort?.field ?? null}
        onChange={onFieldChange}
        deselectable={false}
        noneLabel={t('search.filters.sort.relevance')}
        testID="filters-sort"
      />
      {sort === null ? null : (
        <FilterChoice
          title={t('search.filters.sort.direction.title')}
          options={directions}
          value={sort.direction}
          onChange={changeDirection}
          deselectable={false}
          testID="filters-sort-direction"
        />
      )}
    </Stack>
  );
}
