import { describe, expect, it } from '@jest/globals';

import { entryOf, entryWithMedia, keyOf } from '../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from './library-entry';
import {
  DEFAULT_LIBRARY_VIEW,
  buildLibraryView,
  keepLibraryLayout,
  libraryEntryId,
  type LibraryView,
} from './library-view';

const EARLY = '2026-03-01T08:00:00.000Z';
const MIDDLE = '2026-03-02T08:00:00.000Z';
const LATE = '2026-03-03T08:00:00.000Z';
const LATER = '2026-03-04T08:00:00.000Z';

const currentOf = (entries: readonly LibraryEntry[]): ReadonlyMap<string, LibraryEntry> =>
  new Map(entries.map((entry) => [libraryEntryId(entry.key), entry]));

const viewOf = (entries: readonly LibraryEntry[]): LibraryView =>
  buildLibraryView(entries, DEFAULT_LIBRARY_VIEW, false);

// each group as its status and the external ids of its entries, in order
const layoutOf = (view: LibraryView): [string, number[]][] =>
  view.groups.map((group) => [group.status, group.entries.map((entry) => entry.key.externalId)]);

const FIRST = entryOf({ key: keyOf('anime', 1), updatedAt: LATE });
const SECOND = entryOf({ key: keyOf('anime', 2), updatedAt: MIDDLE });
const THIRD = entryOf({ key: keyOf('anime', 3), updatedAt: EARLY });
const PLANNED = entryOf({ key: keyOf('manga', 4), status: 'planned', updatedAt: MIDDLE });
const ENTRIES = [FIRST, SECOND, THIRD, PLANNED];

describe('libraryEntryId', () => {
  it('joins the namespace, the kind and the external id', () => {
    expect(libraryEntryId(keyOf('manga', 42))).toBe('mal:manga:42');
  });
});

describe('keepLibraryLayout', () => {
  it('returns fresh itself without a frozen layout', () => {
    const fresh = viewOf(ENTRIES);

    expect(keepLibraryLayout(fresh, currentOf(ENTRIES), null)).toBe(fresh);
  });

  it('keeps the position of an entry whose change would sort it first, with its new value', () => {
    const frozen = viewOf(ENTRIES);
    const plusOne = { ...THIRD, progress: THIRD.progress + 1, updatedAt: LATER };
    const entries = [FIRST, SECOND, plusOne, PLANNED];

    const view = keepLibraryLayout(viewOf(entries), currentOf(entries), frozen);

    expect(layoutOf(viewOf(entries))).toStrictEqual([
      ['current', [3, 1, 2]],
      ['planned', [4]],
    ]);
    expect(layoutOf(view)).toStrictEqual([
      ['current', [1, 2, 3]],
      ['planned', [4]],
    ]);
    expect(view.groups[0]?.entries[2]).toBe(plusOne);
  });

  it('keeps a planned entry turned current in the planned group, even under a planned filter', () => {
    const otherPlanned = entryOf({ key: keyOf('anime', 5), status: 'planned', updatedAt: EARLY });
    const options = { ...DEFAULT_LIBRARY_VIEW, status: 'planned' as const };
    const frozen = buildLibraryView([...ENTRIES, otherPlanned], options, false);
    const started = { ...PLANNED, status: 'current' as const, updatedAt: LATER };
    const entries = [FIRST, SECOND, THIRD, started, otherPlanned];

    const view = keepLibraryLayout(
      buildLibraryView(entries, options, false),
      currentOf(entries),
      frozen,
    );

    expect(layoutOf(view)).toStrictEqual([['planned', [4, 5]]]);
    expect(view.groups[0]?.entries[0]).toBe(started);
    expect(view.visibleCount).toBe(2);
  });

  it('drops a removed entry and leaves its emptied group out', () => {
    const frozen = viewOf(ENTRIES);
    const entries = [FIRST, SECOND, THIRD];

    const view = keepLibraryLayout(viewOf(entries), currentOf(entries), frozen);

    expect(layoutOf(view)).toStrictEqual([['current', [1, 2, 3]]]);
    expect(view.visibleCount).toBe(3);
  });

  it('inserts a new entry at the top of its group, creating a group in status order', () => {
    const frozen = viewOf(ENTRIES);
    const added = entryOf({ key: keyOf('anime', 9), updatedAt: EARLY });
    const completed = entryOf({ key: keyOf('anime', 10), status: 'completed', updatedAt: EARLY });
    const adult = entryWithMedia({ isAdult: true }, { key: keyOf('anime', 11) });
    const entries = [...ENTRIES, added, completed, adult];
    const fresh = viewOf(entries);

    const view = keepLibraryLayout(fresh, currentOf(entries), frozen);

    expect(layoutOf(view)).toStrictEqual([
      ['current', [9, 1, 2, 3]],
      ['planned', [4]],
      ['completed', [10]],
    ]);
    expect(view.visibleCount).toBe(6);
    expect(view.hiddenCount).toBe(fresh.hiddenCount);
    expect(view.hiddenCount).toBe(1);
    expect(view.totalCount).toBe(7);
  });
});
