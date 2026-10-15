import {
  SEARCHABLE_FORMATS_BY_KIND,
  type MediaKind,
  type SearchableMediaFormat,
} from '@core/domain/media';
import { useTranslation } from '@core/i18n/index';
import { useMemo } from 'react';

import { FilterChoice, type FilterChoiceOption } from './FilterChoice';
import { FORMAT_KEYS } from './format-keys';

export interface FormatFilterProps {
  kind: MediaKind;
  format: SearchableMediaFormat | null;
  onChange: (format: SearchableMediaFormat | null) => void;
}

/** the format section of the filters sheet: one chip per searchable format of the kind */
export function FormatFilter({ kind, format, onChange }: FormatFilterProps) {
  const { t } = useTranslation();
  const options = useMemo<readonly FilterChoiceOption<SearchableMediaFormat>[]>(
    () =>
      SEARCHABLE_FORMATS_BY_KIND[kind].map((value) => ({ value, label: t(FORMAT_KEYS[value]) })),
    [kind, t],
  );

  return (
    <FilterChoice
      title={t('search.filters.format.title')}
      options={options}
      value={format}
      onChange={onChange}
      deselectable
      testID="filters-format"
    />
  );
}
