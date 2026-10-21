import type { LibraryEntry, LibraryStatus } from '@core/domain/library-entry';
import type { LibraryView } from '@core/domain/library-view';
import type { MediaKey } from '@core/domain/media';

/** the section header of a status group: its status and how many entries it shows */
export interface LibraryGroupHeaderItem {
  readonly type: 'header';
  readonly status: LibraryStatus;
  readonly count: number;
}

/** an entry row */
export interface LibraryEntryItem {
  readonly type: 'entry';
  readonly entry: LibraryEntry;
}

/** one item of the library list: the groups flattened into headers and rows */
export type LibraryListItem = LibraryGroupHeaderItem | LibraryEntryItem;

/** the id of a media key, `<namespace>:<kind>:<externalId>`, unique in a library */
export const libraryEntryId = (key: MediaKey): string =>
  `${key.namespace}:${key.kind}:${String(key.externalId)}`;

/**
 * the groups of a library view as one list: each group's header, then its entries, in the view's
 * order (FR-14)
 */
export const toLibraryListItems = (view: LibraryView): readonly LibraryListItem[] =>
  view.groups.flatMap((group): LibraryListItem[] => [
    { type: 'header', status: group.status, count: group.entries.length },
    ...group.entries.map((entry): LibraryListItem => ({ type: 'entry', entry })),
  ]);

/**
 * the stable list key of an item: `status:<status>` for a header, the entry's media key id for a
 * row: two parts against three, so a header and a row never share a key
 */
export const libraryListItemKey = (item: LibraryListItem): string =>
  item.type === 'header' ? `status:${item.status}` : libraryEntryId(item.entry.key);

/** the kind of an item, so a recycled cell is reused for an item of its own kind */
export const libraryListItemType = (item: LibraryListItem): LibraryListItem['type'] => item.type;
