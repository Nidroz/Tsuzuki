import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from './library-entry';
import { DEFAULT_LIBRARY_VIEW, buildLibraryView, favoriteEntries } from './library-view';

const idsOf = (entries: readonly LibraryEntry[]): number[] =>
  entries.map((entry) => entry.key.externalId);

const favoriteOf = (externalId: number): LibraryEntry =>
  entryOf({ key: keyOf('anime', externalId), isFavorite: true });

const plainOf = (externalId: number): LibraryEntry =>
  entryOf({ key: keyOf('anime', externalId), isFavorite: false });

const LIBRARY = [plainOf(1), favoriteOf(2), plainOf(3), favoriteOf(4), favoriteOf(5)];

describe('favoriteEntries', () => {
  it('FR-15: keeps only the favorites, in their given order', () => {
    expect(idsOf(favoriteEntries(LIBRARY))).toStrictEqual([2, 4, 5]);
    expect(idsOf(favoriteEntries([...LIBRARY].reverse()))).toStrictEqual([5, 4, 2]);
  });

  it.each<[string, readonly LibraryEntry[]]>([
    ['an empty library', []],
    ['a library without a favorite', [plainOf(1), plainOf(2)]],
  ])('returns no entry for %s', (_label, entries) => {
    expect(favoriteEntries(entries)).toStrictEqual([]);
  });

  it('never mutates the entries', () => {
    const entries = Object.freeze([...LIBRARY]);
    const before = [...entries];

    favoriteEntries(entries);

    expect(entries).toStrictEqual(before);
  });

  it('gives the favorites tab a totalCount of the favorites', () => {
    const view = buildLibraryView(favoriteEntries(LIBRARY), DEFAULT_LIBRARY_VIEW, false);

    expect(view.totalCount).toBe(3);
  });
});
