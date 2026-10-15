import { activeFilterCount, type SearchFilters } from '@core/domain/search-filters';
import { useTranslation } from '@core/i18n/index';
import { Button } from '@ui/index';

export interface FiltersButtonProps {
  /** the applied filters: the label counts the active ones */
  filters: SearchFilters;
  onPress: () => void;
}

/** opens the filters sheet; its label shows how many filters are active, when any is */
export function FiltersButton({ filters, onPress }: FiltersButtonProps) {
  const { t } = useTranslation();
  const count = activeFilterCount(filters);
  const label =
    count > 0
      ? t('search.filters.open.labelCount', { active: count })
      : t('search.filters.open.label');

  return (
    <Button
      label={label}
      accessibilityLabel={count > 0 ? t('search.filters.open.activeLabel', { count }) : label}
      accessibilityHint={t('search.filters.open.hint')}
      variant="secondary"
      onPress={onPress}
      testID="search-filters"
    />
  );
}
