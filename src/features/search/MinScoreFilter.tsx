import { MIN_SCORE_OPTIONS } from '@core/domain/search-filters';
import { useTranslation } from '@core/i18n/index';
import { useMemo } from 'react';

import { FilterChoice, type FilterChoiceOption } from './FilterChoice';

export interface MinScoreFilterProps {
  minScore: number | null;
  onChange: (minScore: number | null) => void;
}

/** the minimum score section of the filters sheet: one chip per offered score, "5+" to "9+" */
export function MinScoreFilter({ minScore, onChange }: MinScoreFilterProps) {
  const { t, formatNumber } = useTranslation();
  const options = useMemo<readonly FilterChoiceOption<number>[]>(
    () =>
      MIN_SCORE_OPTIONS.map((value) => {
        const score = formatNumber(value);
        return {
          value,
          label: t('search.filters.minScore.option', { score }),
          accessibilityLabel: t('search.filters.minScore.optionLabel', { score }),
        };
      }),
    [t, formatNumber],
  );

  return (
    <FilterChoice
      title={t('search.filters.minScore.title')}
      options={options}
      value={minScore}
      onChange={onChange}
      deselectable
      testID="filters-min-score"
    />
  );
}
