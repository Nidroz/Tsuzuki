import {
  SEARCHABLE_MEDIA_STATUSES,
  type MediaKind,
  type SearchableMediaStatus,
} from '@core/domain/media';
import { STATUS_KEYS, useTranslation } from '@core/i18n/index';
import { useMemo } from 'react';

import { FilterChoice, type FilterChoiceOption } from './FilterChoice';

export interface StatusFilterProps {
  kind: MediaKind;
  status: SearchableMediaStatus | null;
  onChange: (status: SearchableMediaStatus | null) => void;
}

/** the publication status section of the filters sheet, worded for the kind: airing or publishing */
export function StatusFilter({ kind, status, onChange }: StatusFilterProps) {
  const { t } = useTranslation();
  const options = useMemo<readonly FilterChoiceOption<SearchableMediaStatus>[]>(
    () => SEARCHABLE_MEDIA_STATUSES.map((value) => ({ value, label: t(STATUS_KEYS[kind][value]) })),
    [kind, t],
  );

  return (
    <FilterChoice
      title={t('search.filters.status.title')}
      options={options}
      value={status}
      onChange={onChange}
      deselectable
      testID="filters-status"
    />
  );
}
