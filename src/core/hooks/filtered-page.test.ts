import { describe, expect, it } from '@jest/globals';

import type { MediaSummary, Page } from '../catalog/catalog-provider';
import { selectFilteredPage } from './filtered-page';

const summary = (externalId: number, isAdult: boolean): MediaSummary => ({
  key: { namespace: 'mal', kind: 'anime', externalId },
  title: `Title ${String(externalId)}`,
  titleEnglish: null,
  imageUrl: null,
  format: 'tv',
  status: 'finished',
  totalUnits: null,
  score: null,
  year: null,
  genres: [],
  isAdult,
});

const CLEAN_FIRST = summary(1, false);
const ADULT = summary(2, true);
const CLEAN_LAST = summary(3, false);
const PAGE: Page<MediaSummary> = {
  items: [CLEAN_FIRST, ADULT, CLEAN_LAST],
  page: 2,
  lastPage: 5,
  hasNextPage: true,
};

describe('selectFilteredPage (BR-06)', () => {
  it('hides adult items in order and counts them when adult content is off', () => {
    expect(selectFilteredPage(false)(PAGE)).toStrictEqual({
      items: [CLEAN_FIRST, CLEAN_LAST],
      page: 2,
      lastPage: 5,
      hasNextPage: true,
      hiddenCount: 1,
    });
  });

  it('keeps every item and hides none when adult content is on', () => {
    expect(selectFilteredPage(true)(PAGE)).toStrictEqual({ ...PAGE, hiddenCount: 0 });
  });

  it('counts a page of adult items only as all hidden', () => {
    const page = { ...PAGE, items: [ADULT, summary(4, true)] };

    expect(selectFilteredPage(false)(page)).toMatchObject({ items: [], hiddenCount: 2 });
  });

  it('gives one stable function per setting value, so a query keeps its selection', () => {
    expect(selectFilteredPage(false)).toBe(selectFilteredPage(false));
    expect(selectFilteredPage(true)).toBe(selectFilteredPage(true));
    expect(selectFilteredPage(true)).not.toBe(selectFilteredPage(false));
  });

  it('leaves the cached page untouched', () => {
    selectFilteredPage(false)(PAGE);

    expect(PAGE.items).toStrictEqual([CLEAN_FIRST, ADULT, CLEAN_LAST]);
    expect(PAGE).not.toHaveProperty('hiddenCount');
  });
});
