import { describe, expect, it } from '@jest/globals';

import { entryOf, entryWithMedia, keyOf } from '../../../test/core/library-entry-fixtures';
import type { LibraryEntry, LibraryStatus } from './library-entry';
import {
  DEFAULT_LIBRARY_VIEW,
  LIBRARY_SORT_FIELDS,
  buildLibraryView,
  compareLibraryEntries,
  matchesLibraryFilters,
  type LibrarySortField,
  type LibraryViewOptions,
} from './library-view';

const EARLY = '2026-03-01T08:00:00.000Z';
const MIDDLE = '2026-03-02T08:00:00.000Z';
const LATE = '2026-03-03T08:00:00.000Z';

const optionsOf = (overrides: Partial<LibraryViewOptions> = {}): LibraryViewOptions => ({
  ...DEFAULT_LIBRARY_VIEW,
  ...overrides,
});

const sorted = (sort: LibrarySortField, entries: readonly LibraryEntry[]): LibraryEntry[] =>
  [...entries].sort(compareLibraryEntries(sort));

const idsOf = (entries: readonly LibraryEntry[]): number[] =>
  entries.map((entry) => entry.key.externalId);

const MANGA = entryOf({ key: keyOf('manga', 2), status: 'planned' });

describe('matchesLibraryFilters', () => {
  it.each(LIBRARY_SORT_FIELDS)(
    'keeps every entry with both filters at all, sorted by %s',
    (sort) => {
      expect(matchesLibraryFilters(entryOf(), optionsOf({ sort }))).toBe(true);
      expect(matchesLibraryFilters(MANGA, optionsOf({ sort }))).toBe(true);
    },
  );

  it.each<[string, LibraryStatus, boolean]>([
    ['keeps an entry of the status', 'current', true],
    ['drops an entry of another status', 'planned', false],
    ['drops an entry of a status further in the order', 'dropped', false],
  ])('a status filter %s', (_, status, expected) => {
    expect(matchesLibraryFilters(entryOf({ status: 'current' }), optionsOf({ status }))).toBe(
      expected,
    );
  });

  it('a kind filter keeps an entry of the kind and drops the other kind', () => {
    expect(matchesLibraryFilters(MANGA, optionsOf({ kind: 'manga' }))).toBe(true);
    expect(matchesLibraryFilters(MANGA, optionsOf({ kind: 'anime' }))).toBe(false);
  });

  it('needs both filters to match', () => {
    expect(matchesLibraryFilters(MANGA, optionsOf({ status: 'planned', kind: 'manga' }))).toBe(
      true,
    );
    expect(matchesLibraryFilters(MANGA, optionsOf({ status: 'current', kind: 'manga' }))).toBe(
      false,
    );
    expect(matchesLibraryFilters(MANGA, optionsOf({ status: 'planned', kind: 'anime' }))).toBe(
      false,
    );
  });
});

describe('compareLibraryEntries', () => {
  it('updated: the last change first', () => {
    const early = entryOf({ key: keyOf('anime', 1), updatedAt: EARLY });
    const late = entryOf({ key: keyOf('anime', 2), updatedAt: LATE });
    const middle = entryOf({ key: keyOf('anime', 3), updatedAt: MIDDLE });

    expect(idsOf(sorted('updated', [early, late, middle]))).toStrictEqual([2, 3, 1]);
  });

  it('updated: a tie falls back to the kind order, then the external id ascending', () => {
    const entries = [
      entryOf({ key: keyOf('manga', 1) }),
      entryOf({ key: keyOf('anime', 20) }),
      entryOf({ key: keyOf('anime', 3) }),
    ];

    expect(sorted('updated', entries).map((entry) => entry.key)).toStrictEqual([
      keyOf('anime', 3),
      keyOf('anime', 20),
      keyOf('manga', 1),
    ]);
  });

  it('title: ascending, case and accent insensitive, numbers by value', () => {
    const entries = [
      entryWithMedia({ title: 'Title 10' }, { key: keyOf('anime', 1) }),
      entryWithMedia({ title: 'bleach' }, { key: keyOf('anime', 2) }),
      entryWithMedia({ title: 'Title 2' }, { key: keyOf('anime', 3) }),
      entryWithMedia({ title: 'Élan' }, { key: keyOf('anime', 4) }),
      entryWithMedia({ title: 'Akira' }, { key: keyOf('anime', 5) }),
    ];

    expect(idsOf(sorted('title', entries))).toStrictEqual([5, 2, 4, 3, 1]);
  });

  it('title: titles equal in the collation fall back to the last change, then the key', () => {
    const entries = [
      entryWithMedia({ title: 'elan' }, { key: keyOf('anime', 9), updatedAt: EARLY }),
      entryWithMedia({ title: 'Élan' }, { key: keyOf('anime', 8), updatedAt: LATE }),
      entryWithMedia({ title: 'ELAN' }, { key: keyOf('anime', 7), updatedAt: EARLY }),
    ];

    expect(idsOf(sorted('title', entries))).toStrictEqual([8, 7, 9]);
  });

  it('score: the highest first, no score last', () => {
    const entries = [
      entryOf({ key: keyOf('anime', 1), score: null }),
      entryOf({ key: keyOf('anime', 2), score: 7 }),
      entryOf({ key: keyOf('anime', 3), score: 10 }),
      entryOf({ key: keyOf('anime', 4), score: 1 }),
    ];

    expect(idsOf(sorted('score', entries))).toStrictEqual([3, 2, 4, 1]);
  });

  it('score: equal scores and missing scores fall back to the last change, then the key', () => {
    const entries = [
      entryOf({ key: keyOf('anime', 1), score: null, updatedAt: EARLY }),
      entryOf({ key: keyOf('anime', 2), score: 8, updatedAt: EARLY }),
      entryOf({ key: keyOf('anime', 3), score: null, updatedAt: LATE }),
      entryOf({ key: keyOf('anime', 4), score: 8, updatedAt: LATE }),
      entryOf({ key: keyOf('manga', 1), score: 8, updatedAt: EARLY }),
    ];

    expect(sorted('score', entries).map((entry) => entry.key)).toStrictEqual([
      keyOf('anime', 4),
      keyOf('anime', 2),
      keyOf('manga', 1),
      keyOf('anime', 3),
      keyOf('anime', 1),
    ]);
  });

  it.each(LIBRARY_SORT_FIELDS)('%s: a total order, whatever the input order', (sort) => {
    const first = entryWithMedia({ title: 'Same' }, { key: keyOf('anime', 1), score: 5 });
    const entries = [
      first,
      entryWithMedia({ title: 'same' }, { key: keyOf('manga', 1), score: 5 }),
      entryWithMedia({ title: 'Same' }, { key: keyOf('anime', 2), score: 5 }),
    ];
    const compare = compareLibraryEntries(sort);

    expect(sorted(sort, [...entries].reverse())).toStrictEqual(sorted(sort, entries));
    expect(compare(first, { ...first })).toBe(0);
    expect(compareLibraryEntries(sort)).toBe(compare);
  });
});

describe('buildLibraryView', () => {
  const current = entryOf({ key: keyOf('anime', 1), status: 'current', updatedAt: EARLY });
  const recentCurrent = entryOf({ key: keyOf('anime', 2), status: 'current', updatedAt: LATE });
  const dropped = entryOf({ key: keyOf('anime', 3), status: 'dropped', updatedAt: MIDDLE });
  const planned = entryOf({ key: keyOf('manga', 4), status: 'planned', updatedAt: MIDDLE });
  const adultAnime = entryWithMedia(
    { isAdult: true },
    { key: keyOf('anime', 5), status: 'current', updatedAt: MIDDLE },
  );
  const adultManga = entryWithMedia(
    { isAdult: true },
    { key: keyOf('manga', 6), status: 'paused', updatedAt: MIDDLE },
  );
  const LIBRARY = [dropped, current, planned, recentCurrent, adultAnime, adultManga];

  const groupsOf = (entries: readonly LibraryEntry[], options: LibraryViewOptions, adult = false) =>
    buildLibraryView(entries, options, adult).groups.map((group) => ({
      status: group.status,
      ids: idsOf(group.entries),
    }));

  it('groups by status in the library status order, sorted, empty groups left out', () => {
    expect(groupsOf(LIBRARY, optionsOf())).toStrictEqual([
      { status: 'current', ids: [2, 1] },
      { status: 'planned', ids: [4] },
      { status: 'dropped', ids: [3] },
    ]);
  });

  it('sorts inside each group by the sort field', () => {
    const better = entryOf({ key: keyOf('anime', 7), status: 'current', score: 10 });
    const worse = entryOf({ key: keyOf('anime', 8), status: 'current', score: 2 });

    expect(groupsOf([worse, better], optionsOf({ sort: 'score' }))).toStrictEqual([
      { status: 'current', ids: [7, 8] },
    ]);
  });

  it('keeps the entries matching the status and kind filters only', () => {
    expect(groupsOf(LIBRARY, optionsOf({ status: 'current' }))).toStrictEqual([
      { status: 'current', ids: [2, 1] },
    ]);
    expect(groupsOf(LIBRARY, optionsOf({ kind: 'manga' }), true)).toStrictEqual([
      { status: 'planned', ids: [4] },
      { status: 'paused', ids: [6] },
    ]);
    expect(groupsOf(LIBRARY, optionsOf({ status: 'completed' }))).toStrictEqual([]);
  });

  it('hides the adult entries while the setting is off, counting those matching the filters', () => {
    const all = buildLibraryView(LIBRARY, optionsOf(), false);
    const anime = buildLibraryView(LIBRARY, optionsOf({ kind: 'anime' }), false);
    const planned = buildLibraryView(LIBRARY, optionsOf({ status: 'planned' }), false);

    expect([all.visibleCount, all.hiddenCount]).toStrictEqual([4, 2]);
    expect([anime.visibleCount, anime.hiddenCount]).toStrictEqual([3, 1]);
    expect([planned.visibleCount, planned.hiddenCount]).toStrictEqual([1, 0]);
  });

  it('shows the adult entries while the setting is on, hiding nothing', () => {
    const view = buildLibraryView(LIBRARY, optionsOf(), true);

    expect(view.hiddenCount).toBe(0);
    expect(view.visibleCount).toBe(LIBRARY.length);
    expect(groupsOf(LIBRARY, optionsOf(), true)).toStrictEqual([
      { status: 'current', ids: [2, 5, 1] },
      { status: 'planned', ids: [4] },
      { status: 'paused', ids: [6] },
      { status: 'dropped', ids: [3] },
    ]);
  });

  it('counts every entry in totalCount, before any filter', () => {
    const filtered = buildLibraryView(LIBRARY, optionsOf({ status: 'completed' }), false);
    const empty = buildLibraryView([], optionsOf(), false);

    expect(filtered).toStrictEqual({
      groups: [],
      visibleCount: 0,
      hiddenCount: 0,
      totalCount: LIBRARY.length,
    });
    expect(empty).toStrictEqual({ groups: [], visibleCount: 0, hiddenCount: 0, totalCount: 0 });
  });

  it.each([true, false])('never mutates the entries (showAdult %s)', (showAdult) => {
    const entries = Object.freeze([...LIBRARY]);
    const before = [...entries];

    buildLibraryView(entries, optionsOf({ sort: 'title' }), showAdult);

    expect(entries).toStrictEqual(before);
  });
});
