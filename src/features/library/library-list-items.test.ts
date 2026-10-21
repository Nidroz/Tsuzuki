import type { LibraryView } from '@core/domain/library-view';
import { describe, expect, it } from '@jest/globals';

import { BERSERK, FRIEREN, MONSTER } from './__fixtures__/library-entries';
import {
  libraryEntryId,
  libraryListItemKey,
  libraryListItemType,
  toLibraryListItems,
} from './library-list-items';

const VIEW: LibraryView = {
  groups: [
    { status: 'current', entries: [FRIEREN, BERSERK] },
    { status: 'planned', entries: [MONSTER] },
  ],
  visibleCount: 3,
  hiddenCount: 0,
  totalCount: 3,
};

describe('toLibraryListItems', () => {
  it('flattens each group into its header and its entries, in order', () => {
    expect(toLibraryListItems(VIEW)).toStrictEqual([
      { type: 'header', status: 'current', count: 2 },
      { type: 'entry', entry: FRIEREN },
      { type: 'entry', entry: BERSERK },
      { type: 'header', status: 'planned', count: 1 },
      { type: 'entry', entry: MONSTER },
    ]);
  });

  it('gives no item for a view without groups', () => {
    expect(toLibraryListItems({ ...VIEW, groups: [], visibleCount: 0 })).toStrictEqual([]);
  });
});

describe('library list keys and types', () => {
  it('keys a header by its status and a row by its media key, all distinct', () => {
    const keys = toLibraryListItems(VIEW).map(libraryListItemKey);

    expect(keys).toStrictEqual([
      'status:current',
      'mal:anime:52991',
      'mal:manga:2',
      'status:planned',
      'mal:anime:19',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(libraryEntryId(FRIEREN.key)).toBe('mal:anime:52991');
  });

  it('types headers and rows apart for recycling', () => {
    expect(toLibraryListItems(VIEW).map(libraryListItemType)).toStrictEqual([
      'header',
      'entry',
      'entry',
      'header',
      'entry',
    ]);
  });
});
