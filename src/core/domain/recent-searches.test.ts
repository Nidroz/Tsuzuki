import { describe, expect, it } from '@jest/globals';

import { RECENT_SEARCHES_MAX, addRecentSearch, normalizeRecentSearches } from './recent-searches';

// n distinct searches, newest first
const searches = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `query ${String(index)}`);

describe('FR-02 RECENT_SEARCHES_MAX', () => {
  it('is 10', () => {
    expect(RECENT_SEARCHES_MAX).toBe(10);
  });
});

describe('FR-02 normalizeRecentSearches', () => {
  it('keeps a list that already follows the rules, in its order', () => {
    expect(normalizeRecentSearches(['naruto', 'Frieren', 'mushishi'])).toStrictEqual([
      'naruto',
      'Frieren',
      'mushishi',
    ]);
    expect(normalizeRecentSearches([])).toStrictEqual([]);
  });

  it('keeps only the first (newest) of entries equal ignoring case, with its casing', () => {
    expect(
      normalizeRecentSearches(['Frieren', 'naruto', 'FRIEREN', 'frieren', 'Naruto']),
    ).toStrictEqual(['Frieren', 'naruto']);
  });

  it('folds non-latin case without the device locale', () => {
    expect(normalizeRecentSearches(['ÉTÉ', 'été', 'Ωμέγα', 'ωμέγα'])).toStrictEqual([
      'ÉTÉ',
      'Ωμέγα',
    ]);
  });

  it('caps the list at RECENT_SEARCHES_MAX, dropping the oldest', () => {
    const list = searches(RECENT_SEARCHES_MAX + 3);
    expect(normalizeRecentSearches(list)).toStrictEqual(list.slice(0, RECENT_SEARCHES_MAX));
  });

  it('caps after removing duplicates', () => {
    const list = ['dup', 'DUP', ...searches(RECENT_SEARCHES_MAX)];
    expect(normalizeRecentSearches(list)).toStrictEqual([
      'dup',
      ...searches(RECENT_SEARCHES_MAX - 1),
    ]);
  });
});

describe('FR-02 addRecentSearch', () => {
  it('records a new search as the newest', () => {
    expect(addRecentSearch(['naruto'], 'frieren')).toStrictEqual(['frieren', 'naruto']);
    expect(addRecentSearch([], 'frieren')).toStrictEqual(['frieren']);
  });

  it('moves a search already in the list to the top with its new casing', () => {
    expect(addRecentSearch(['naruto', 'frieren', 'mushishi'], 'Frieren')).toStrictEqual([
      'Frieren',
      'naruto',
      'mushishi',
    ]);
  });

  it('drops the oldest search when the list is full', () => {
    const full = searches(RECENT_SEARCHES_MAX);
    expect(addRecentSearch(full, 'new')).toStrictEqual([
      'new',
      ...full.slice(0, RECENT_SEARCHES_MAX - 1),
    ]);
  });

  it('does not modify the given list', () => {
    const list = ['naruto'];
    addRecentSearch(list, 'frieren');
    expect(list).toStrictEqual(['naruto']);
  });
});
