import { describe, expect, it } from '@jest/globals';

import { DEFAULT_SHOW_ADULT, applyContentFilter, isAdultMedia } from './content-filter';

describe('BR-06 isAdultMedia', () => {
  it.each(['Hentai', 'Erotica'])('flags a title with the %s genre', (genre) => {
    expect(isAdultMedia({ kind: 'manga', genreNames: ['Action', genre], isRxRated: false })).toBe(
      true,
    );
  });

  it('compares genre names case-insensitively and trimmed', () => {
    expect(isAdultMedia({ kind: 'anime', genreNames: ['  hEnTaI '], isRxRated: false })).toBe(true);
    expect(isAdultMedia({ kind: 'anime', genreNames: ['EROTICA\n'], isRxRated: false })).toBe(true);
  });

  it('flags an Rx-rated anime even without an adult genre', () => {
    expect(isAdultMedia({ kind: 'anime', genreNames: ['Comedy'], isRxRated: true })).toBe(true);
  });

  it('ignores the Rx rating on a manga', () => {
    expect(isAdultMedia({ kind: 'manga', genreNames: ['Comedy'], isRxRated: true })).toBe(false);
  });

  it('does not flag a clean title, including genres that only contain an adult name', () => {
    expect(isAdultMedia({ kind: 'anime', genreNames: [], isRxRated: false })).toBe(false);
    expect(
      isAdultMedia({ kind: 'anime', genreNames: ['Ecchi', 'Hentai Parody'], isRxRated: false }),
    ).toBe(false);
  });
});

describe('BR-06 applyContentFilter', () => {
  const items = [
    { id: 1, isAdult: false },
    { id: 2, isAdult: true },
    { id: 3, isAdult: false },
    { id: 4, isAdult: true },
    { id: 5, isAdult: false },
  ] as const;

  it('hides adult items, keeps the order and counts the hidden ones when showAdult is off', () => {
    const result = applyContentFilter(items, false);
    expect(result.items.map((item) => item.id)).toStrictEqual([1, 3, 5]);
    expect(result.hiddenCount).toBe(2);
  });

  it('returns an empty result for an empty list', () => {
    expect(applyContentFilter([], false)).toStrictEqual({ items: [], hiddenCount: 0 });
    expect(applyContentFilter([], true)).toStrictEqual({ items: [], hiddenCount: 0 });
  });

  it('hides everything when every item is adult', () => {
    const adultOnly = [
      { id: 1, isAdult: true },
      { id: 2, isAdult: true },
    ];
    expect(applyContentFilter(adultOnly, false)).toStrictEqual({ items: [], hiddenCount: 2 });
  });

  it('returns every item with hiddenCount 0 when showAdult is on', () => {
    const result = applyContentFilter(items, true);
    expect(result.items).toStrictEqual(items);
    expect(result.hiddenCount).toBe(0);
  });
});

describe('BR-06 DEFAULT_SHOW_ADULT', () => {
  it('hides adult content by default', () => {
    expect(DEFAULT_SHOW_ADULT).toBe(false);
    expect(applyContentFilter([{ isAdult: true }], DEFAULT_SHOW_ADULT).items).toStrictEqual([]);
  });
});
