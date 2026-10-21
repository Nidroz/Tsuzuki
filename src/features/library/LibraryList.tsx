import type { LibraryStatus } from '@core/domain/library-entry';
import type { LibraryKindFilter, LibraryView, LibraryViewOptions } from '@core/domain/library-view';
import type { MediaKey } from '@core/domain/media';
import { LIBRARY_VIEW_STATUS_KEYS, useTranslation } from '@core/i18n/index';
import { EmptyState, List, Stack, Text, type StateAction } from '@ui/index';
import { memo, useCallback, useMemo } from 'react';

import { LibraryEntryRow } from './LibraryEntryRow';
import { LibraryFilters } from './LibraryFilters';
import {
  libraryListItemKey,
  libraryListItemType,
  toLibraryListItems,
  type LibraryListItem,
} from './library-list-items';

/** the testIDs of the list: `library-list`, `-no-match`, `-hidden-note`, `-group-<status>` */
export const LIBRARY_LIST_TEST_ID = 'library-list';

export interface LibraryListProps {
  /** the library as shown, with at least one entry in the library (filtered out or not) */
  view: LibraryView;
  options: LibraryViewOptions;
  /** called with the options to show, never with the current ones */
  onOptionsChange: (options: LibraryViewOptions) => void;
  /** back to every kind and status; absent when they are already shown */
  onResetFilters: (() => void) | null;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (key: MediaKey) => void;
}

interface LibraryGroupHeaderProps {
  status: LibraryStatus;
  count: number;
  kind: LibraryKindFilter;
}

function LibraryGroupHeaderView({ status, count, kind }: LibraryGroupHeaderProps) {
  const { t, formatNumber } = useTranslation();
  return (
    <Text variant="subtitle" heading testID={`${LIBRARY_LIST_TEST_ID}-group-${status}`}>
      {t('library.list.group', {
        status: t(LIBRARY_VIEW_STATUS_KEYS[kind][status]),
        size: formatNumber(count),
      })}
    </Text>
  );
}

// the section header of a status group: its status, worded for the kind filter, and its count
const LibraryGroupHeader = memo(LibraryGroupHeaderView);

/**
 * the library list (FR-14): the filters, the note of the adult entries hidden (BR-06), then each
 * status group's header and its rows. when the filters match nothing, a message with a way back
 * to every kind and status replaces the rows; the list goes back to the top when the options change
 */
export function LibraryList({
  view,
  options,
  onOptionsChange,
  onResetFilters,
  onOpen,
}: LibraryListProps) {
  const { t } = useTranslation();
  const { kind } = options;
  const items = useMemo(() => toLibraryListItems(view), [view]);
  const renderItem = useCallback(
    (item: LibraryListItem) =>
      item.type === 'header' ? (
        <LibraryGroupHeader status={item.status} count={item.count} kind={kind} />
      ) : (
        <LibraryEntryRow entry={item.entry} onOpen={onOpen} />
      ),
    [kind, onOpen],
  );
  const reset = useMemo<StateAction | undefined>(
    () =>
      onResetFilters === null
        ? undefined
        : { label: t('library.list.noMatch.reset'), onPress: onResetFilters },
    [t, onResetFilters],
  );

  const header = (
    <Stack gap="sm">
      <LibraryFilters options={options} onChange={onOptionsChange} />
      {view.hiddenCount > 0 ? (
        <Text variant="caption" tone="muted" testID={`${LIBRARY_LIST_TEST_ID}-hidden-note`}>
          {t('library.list.hidden', { count: view.hiddenCount })}
        </Text>
      ) : null}
    </Stack>
  );
  const empty = (
    <EmptyState
      title={t('library.list.noMatch.title')}
      message={t('library.list.noMatch.message')}
      {...(reset !== undefined && { action: reset })}
      testID={`${LIBRARY_LIST_TEST_ID}-no-match`}
    />
  );

  return (
    <List
      items={items}
      renderItem={renderItem}
      keyOf={libraryListItemKey}
      itemTypeOf={libraryListItemType}
      header={header}
      empty={empty}
      scrollToTopKey={JSON.stringify([options.kind, options.status, options.sort])}
      testID={LIBRARY_LIST_TEST_ID}
    />
  );
}
