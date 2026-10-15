import { YEAR_FROM_MAX, YEAR_FROM_MIN } from '@core/domain/search-filters';
import { useTranslation } from '@core/i18n/index';
import { Input } from '@ui/index';

// the year field takes four digits, the length of the highest year
const YEAR_INPUT_MAX_LENGTH = String(YEAR_FROM_MAX).length;

export interface YearFilterProps {
  /** the field text, as typed */
  text: string;
  /** the text is neither blank nor a valid year: the error shows */
  invalid: boolean;
  onChangeText: (text: string) => void;
}

/** the "from year" section of the filters sheet: a numeric field, blank for no year filter */
export function YearFilter({ text, invalid, onChangeText }: YearFilterProps) {
  const { t } = useTranslation();

  return (
    <Input
      label={t('search.filters.year.label')}
      placeholder={t('search.filters.year.placeholder')}
      value={text}
      onChangeText={onChangeText}
      keyboardType="number-pad"
      returnKeyType="done"
      maxLength={YEAR_INPUT_MAX_LENGTH}
      {...(invalid && {
        error: t('search.filters.year.invalid', { min: YEAR_FROM_MIN, max: YEAR_FROM_MAX }),
      })}
      testID="filters-year"
    />
  );
}
