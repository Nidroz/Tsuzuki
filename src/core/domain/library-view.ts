// the library list view (FR-14): entries filtered by status and kind, adult entries hidden when the
// setting is off (BR-06), sorted, then grouped by status. docs/ARCHITECTURE.md §6 "Library"
import { applyContentFilter } from './content-filter';
import { LIBRARY_STATUSES, type LibraryEntry, type LibraryStatus } from './library-entry';
import { compareMediaKeys, type MediaKey, type MediaKind } from './media';

/**
 * the fields the library can be sorted by (FR-14): `updated` the last change first, `title` the
 * snapshot title in a fixed collation, `score` the user's score highest first, no score last.
 * there is no direction toggle; ties fall back to the repository order.
 */
export const LIBRARY_SORT_FIELDS = ['updated', 'title', 'score'] as const;

export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];

/** the value of a status or kind filter that keeps every entry. */
export const LIBRARY_FILTER_ALL = 'all';

/** one library status, or every status. */
export type LibraryStatusFilter = LibraryStatus | typeof LIBRARY_FILTER_ALL;

/** one media kind, or every kind. */
export type LibraryKindFilter = MediaKind | typeof LIBRARY_FILTER_ALL;

/** what the library screen shows: the status and kind filters and the sort field. */
export interface LibraryViewOptions {
  readonly status: LibraryStatusFilter;
  readonly kind: LibraryKindFilter;
  readonly sort: LibrarySortField;
}

/** the library screen on first open: every status and kind, the last change first. */
export const DEFAULT_LIBRARY_VIEW: LibraryViewOptions = {
  status: LIBRARY_FILTER_ALL,
  kind: LIBRARY_FILTER_ALL,
  sort: 'updated',
};

/** the shown entries of one status, in the sort order; never empty. */
export interface LibraryGroup {
  readonly status: LibraryStatus;
  readonly entries: readonly LibraryEntry[];
}

/** the library as the screen shows it, with the counts of its empty and hidden states. */
export interface LibraryView {
  /** one group per status with shown entries, in LIBRARY_STATUSES order; empty groups left out. */
  readonly groups: readonly LibraryGroup[];
  /** the entries in the groups. */
  readonly visibleCount: number;
  /** the adult entries matching the filters, hidden while the setting is off (BR-06). */
  readonly hiddenCount: number;
  /** every entry of the library, before any filter: 0 is the empty library. */
  readonly totalCount: number;
}

type LibraryEntryComparator = (a: LibraryEntry, b: LibraryEntry) => number;

// catalog titles are in the provider's language: one fixed collation, whatever the ui language
const TITLE_COLLATION_LOCALE = 'en';

const titleCollator = new Intl.Collator(TITLE_COLLATION_LOCALE, {
  sensitivity: 'base',
  numeric: true,
});

/**
 * whether an entry passes the status and kind filters of `options`: each LIBRARY_FILTER_ALL or the
 * entry's own value. the sort is ignored.
 */
export const matchesLibraryFilters = (entry: LibraryEntry, options: LibraryViewOptions): boolean =>
  (options.status === LIBRARY_FILTER_ALL || options.status === entry.status) &&
  (options.kind === LIBRARY_FILTER_ALL || options.kind === entry.key.kind);

// the last change first: normalized iso timestamps compare as text (docs/ARCHITECTURE.md §4)
const compareUpdatedAt: LibraryEntryComparator = (a, b) => {
  if (a.updatedAt === b.updatedAt) {
    return 0;
  }
  return a.updatedAt > b.updatedAt ? -1 : 1;
};

const compareTitles: LibraryEntryComparator = (a, b) =>
  titleCollator.compare(a.media.title, b.media.title);

// the highest score first, no score last
const compareScores: LibraryEntryComparator = (a, b) => {
  if (a.score === b.score) {
    return 0;
  }
  if (a.score === null) {
    return 1;
  }
  if (b.score === null) {
    return -1;
  }
  return b.score - a.score;
};

// the repository order (docs/ARCHITECTURE.md §4): a total order, two entries of one library never
// share a key
const compareRepositoryOrder: LibraryEntryComparator = (a, b) =>
  compareUpdatedAt(a, b) || compareMediaKeys(a.key, b.key);

const withRepositoryOrder =
  (primary: LibraryEntryComparator): LibraryEntryComparator =>
  (a, b) =>
    primary(a, b) || compareRepositoryOrder(a, b);

// one comparator per field, so a caller gets the same reference for the same sort
const COMPARATORS: Readonly<Record<LibrarySortField, LibraryEntryComparator>> = {
  updated: compareRepositoryOrder,
  title: withRepositoryOrder(compareTitles),
  score: withRepositoryOrder(compareScores),
};

/**
 * the comparator of a sort field (FR-14): `updated` the last change first, `title` the snapshot
 * title ascending in a fixed collation, `score` the highest first and no score last. every tie
 * falls back to the repository order (`updatedAt` descending, then the media key ascending), so
 * the order is total.
 */
export const compareLibraryEntries = (sort: LibrarySortField): LibraryEntryComparator =>
  COMPARATORS[sort];

/**
 * the library as the screen shows it (FR-14): the entries matching the status and kind filters,
 * the adult ones hidden when `showAdult` is off (BR-06), sorted, grouped by status in
 * LIBRARY_STATUSES order with empty groups left out. `hiddenCount` counts the adult entries
 * matching the filters, `totalCount` every entry. `entries` is never mutated.
 */
export const buildLibraryView = (
  entries: readonly LibraryEntry[],
  options: LibraryViewOptions,
  showAdult: boolean,
): LibraryView => {
  const matching = entries
    .filter((entry) => matchesLibraryFilters(entry, options))
    .map((entry) => ({ entry, isAdult: entry.media.isAdult }));
  const { items, hiddenCount } = applyContentFilter(matching, showAdult);
  // map builds a new array, so the sort never touches `entries`
  const shown = items.map(({ entry }) => entry).sort(compareLibraryEntries(options.sort));
  const groups = LIBRARY_STATUSES.map((status) => ({
    status,
    entries: shown.filter((entry) => entry.status === status),
  })).filter((group) => group.entries.length > 0);
  return { groups, visibleCount: shown.length, hiddenCount, totalCount: entries.length };
};

/**
 * the identity of a library entry as a string, `<namespace>:<kind>:<externalId>`: two entries of
 * one library never share it. namespaces and kinds hold no colon.
 */
export const libraryEntryId = (key: MediaKey): string =>
  `${key.namespace}:${key.kind}:${String(key.externalId)}`;

const groupEntriesOf = (view: LibraryView, status: LibraryStatus): readonly LibraryEntry[] =>
  view.groups.find((group) => group.status === status)?.entries ?? [];

/**
 * `fresh` laid out like `frozen`: each entry shown in `frozen` keeps its group and position
 * with its current value from `current` (a status change does not move it, a filter it no longer
 * matches does not hide it), an entry gone from `current` is dropped, and an entry of `fresh`
 * absent from `frozen` is inserted at the top of its fresh group (a group created if needed, groups
 * in LIBRARY_STATUSES order); empty groups are left out. visibleCount is recounted; hiddenCount and
 * totalCount come from `fresh`. returns `fresh` itself when `frozen` is null.
 */
export const keepLibraryLayout = (
  fresh: LibraryView,
  current: ReadonlyMap<string, LibraryEntry>,
  frozen: LibraryView | null,
): LibraryView => {
  if (frozen === null) {
    return fresh;
  }
  const frozenIds = new Set(
    frozen.groups.flatMap((group) => group.entries.map((entry) => libraryEntryId(entry.key))),
  );
  const groups = LIBRARY_STATUSES.map((status) => {
    const inserted = groupEntriesOf(fresh, status).filter(
      (entry) => !frozenIds.has(libraryEntryId(entry.key)),
    );
    const kept = groupEntriesOf(frozen, status).flatMap((entry) => {
      const value = current.get(libraryEntryId(entry.key));
      return value === undefined ? [] : [value];
    });
    return { status, entries: [...inserted, ...kept] };
  }).filter((group) => group.entries.length > 0);
  const visibleCount = groups.reduce((count, group) => count + group.entries.length, 0);
  return {
    groups,
    visibleCount,
    hiddenCount: fresh.hiddenCount,
    totalCount: fresh.totalCount,
  };
};
