import { LIBRARY_STATUSES } from '@core/domain/library-entry';
import {
  LIBRARY_FILTER_ALL,
  LIBRARY_SORT_FIELDS,
  type LibraryKindFilter,
  type LibrarySortField,
  type LibraryStatusFilter,
  type LibraryViewOptions,
} from '@core/domain/library-view';
import { MEDIA_KINDS } from '@core/domain/media';
import {
  LIBRARY_SORT_KEYS,
  LIBRARY_VIEW_STATUS_KEYS,
  useTranslation,
  type TranslationKey,
} from '@core/i18n/index';
import { ChoiceChips, type ChoiceChipOption } from '@features/media-list/ChoiceChips';
import { Stack, Text } from '@ui/index';
import { useCallback, useMemo, type ReactNode } from 'react';

const KIND_KEYS = {
  [LIBRARY_FILTER_ALL]: 'library.list.filters.all',
  anime: 'library.list.filters.anime',
  manga: 'library.list.filters.manga',
} as const satisfies Record<LibraryKindFilter, TranslationKey>;

const KIND_FILTERS: readonly LibraryKindFilter[] = [LIBRARY_FILTER_ALL, ...MEDIA_KINDS];
const STATUS_FILTERS: readonly LibraryStatusFilter[] = [LIBRARY_FILTER_ALL, ...LIBRARY_STATUSES];

/** the testID prefix of the filter groups: `<prefix>-kind`, `-status`, `-sort` */
export const LIBRARY_FILTERS_TEST_ID = 'library-filters';

export interface LibraryFiltersProps {
  options: LibraryViewOptions;
  /** called with the options to show, never with the current ones */
  onChange: (options: LibraryViewOptions) => void;
  /** the testID prefix of the groups; LIBRARY_FILTERS_TEST_ID by default */
  testID?: string;
}

interface FilterGroupProps {
  label: string;
  children: ReactNode;
}

// a visible label above its chips, which name their radio group with the same text
function FilterGroup({ label, children }: FilterGroupProps) {
  return (
    <Stack gap="xs">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

/**
 * the kind, status and sort of the library list (FR-14), each a radio group of chips. the
 * statuses are worded for the kind chosen, kind-neutral with every kind
 */
export function LibraryFilters({
  options,
  onChange,
  testID = LIBRARY_FILTERS_TEST_ID,
}: LibraryFiltersProps) {
  const { t } = useTranslation();
  const statusKeys = LIBRARY_VIEW_STATUS_KEYS[options.kind];

  const kindOptions = useMemo<readonly ChoiceChipOption<LibraryKindFilter>[]>(
    () => KIND_FILTERS.map((value) => ({ value, label: t(KIND_KEYS[value]) })),
    [t],
  );
  const statusOptions = useMemo<readonly ChoiceChipOption<LibraryStatusFilter>[]>(
    () =>
      STATUS_FILTERS.map((value) => ({
        value,
        label: t(value === LIBRARY_FILTER_ALL ? 'library.list.filters.all' : statusKeys[value]),
      })),
    [t, statusKeys],
  );
  const sortOptions = useMemo<readonly ChoiceChipOption<LibrarySortField>[]>(
    () => LIBRARY_SORT_FIELDS.map((value) => ({ value, label: t(LIBRARY_SORT_KEYS[value]) })),
    [t],
  );

  const changeKind = useCallback(
    (kind: LibraryKindFilter) => {
      onChange({ ...options, kind });
    },
    [onChange, options],
  );
  const changeStatus = useCallback(
    (status: LibraryStatusFilter) => {
      onChange({ ...options, status });
    },
    [onChange, options],
  );
  const changeSort = useCallback(
    (sort: LibrarySortField) => {
      onChange({ ...options, sort });
    },
    [onChange, options],
  );

  const kindLabel = t('library.list.filters.kind');
  const statusLabel = t('library.list.filters.status');
  const sortLabel = t('library.list.filters.sort');

  return (
    <Stack gap="sm">
      <FilterGroup label={kindLabel}>
        <ChoiceChips
          accessibilityLabel={kindLabel}
          options={kindOptions}
          value={options.kind}
          onChange={changeKind}
          testID={`${testID}-kind`}
        />
      </FilterGroup>
      <FilterGroup label={statusLabel}>
        <ChoiceChips
          accessibilityLabel={statusLabel}
          options={statusOptions}
          value={options.status}
          onChange={changeStatus}
          testID={`${testID}-status`}
        />
      </FilterGroup>
      <FilterGroup label={sortLabel}>
        <ChoiceChips
          accessibilityLabel={sortLabel}
          options={sortOptions}
          value={options.sort}
          onChange={changeSort}
          testID={`${testID}-sort`}
        />
      </FilterGroup>
    </Stack>
  );
}
