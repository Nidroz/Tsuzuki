import { describe, expect, it } from '@jest/globals';

import {
  clampPage,
  DEFAULT_SIBLINGS,
  FIRST_PAGE,
  pageWindow,
  type PageWindowItem,
  parsePageInput,
  toPageCount,
} from './page-window';

const ELLIPSIS = 'ellipsis';

describe('toPageCount', () => {
  it.each([
    [0, 0],
    [1, 1],
    [12, 12],
    [12.9, 12],
    [-3, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0],
  ])('turns %p into %p pages', (pageCount, expected) => {
    expect(toPageCount(pageCount)).toBe(expected);
  });
});

describe('clampPage', () => {
  it.each([
    ['a page in range', 5, 10, 5],
    ['the first page', 1, 10, 1],
    ['the last page', 10, 10, 10],
    ['a page after the last one', 11, 10, 10],
    ['a page far after the last one', 1000, 10, 10],
    ['page 0', 0, 10, 1],
    ['a negative page', -4, 10, 1],
    ['a fractional page (truncated)', 3.7, 10, 3],
    ['a fractional page below 1', 0.5, 10, 1],
    ['NaN', Number.NaN, 10, 1],
    ['+Infinity', Number.POSITIVE_INFINITY, 10, 1],
    ['-Infinity', Number.NEGATIVE_INFINITY, 10, 1],
    ['any page when there is no page', 4, 0, 1],
    ['any page with a negative page count', 4, -2, 1],
    ['any page with a NaN page count', 4, Number.NaN, 1],
    ['a page with a fractional page count', 9, 7.8, 7],
  ])('clamps %s', (_label, page, pageCount, expected) => {
    expect(clampPage(page, pageCount)).toBe(expected);
  });
});

describe('parsePageInput', () => {
  it.each([
    ['a page in range', '4', 10, 4],
    ['surrounding spaces', '  7 ', 10, 7],
    ['leading zeros', '007', 10, 7],
    ['the first page', '1', 10, 1],
    ['the last page', '10', 10, 10],
    ['a page after the last one (clamped)', '42', 10, 10],
    ['page 0 (clamped)', '0', 10, 1],
    ['a huge number (clamped)', '99999999999999999999', 10, 10],
  ])('reads %s', (_label, text, pageCount, expected) => {
    expect(parsePageInput(text, pageCount)).toBe(expected);
  });

  it.each([
    ['empty text', ''],
    ['blank text', '   '],
    ['a negative number', '-3'],
    ['a plus sign', '+3'],
    ['a decimal', '2.5'],
    ['a comma decimal', '2,5'],
    ['letters', 'abc'],
    ['digits then letters', '3a'],
    ['an exponent', '1e2'],
    ['inner spaces', '1 2'],
  ])('ignores %s', (_label, text) => {
    expect(parsePageInput(text, 10)).toBeNull();
  });

  it.each([
    ['no page', 0],
    ['a negative page count', -1],
    ['a NaN page count', Number.NaN],
  ])('returns null when there is %s', (_label, pageCount) => {
    expect(parsePageInput('1', pageCount)).toBeNull();
  });
});

describe('pageWindow', () => {
  it('uses one sibling by default', () => {
    expect(DEFAULT_SIBLINGS).toBe(1);
    expect(pageWindow({ page: 10, pageCount: 20 })).toStrictEqual(
      pageWindow({ page: 10, pageCount: 20, siblings: 1 }),
    );
  });

  it.each<[string, number, number, PageWindowItem[]]>([
    ['a single page', 1, 1, [1]],
    ['two pages, first', 1, 2, [1, 2]],
    ['two pages, last', 2, 2, [1, 2]],
    ['every page when they fit the window', 3, 5, [1, 2, 3, 4, 5]],
    ['every page with one hidden page on each side', 4, 7, [1, 2, 3, 4, 5, 6, 7]],
    ['an ellipsis after the start', 1, 20, [1, 2, ELLIPSIS, 20]],
    ['an ellipsis after page 2', 2, 20, [1, 2, 3, ELLIPSIS, 20]],
    ['page 2 instead of an ellipsis for one hidden page', 4, 20, [1, 2, 3, 4, 5, ELLIPSIS, 20]],
    ['an ellipsis on both sides in the middle', 10, 20, [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]],
    ['an ellipsis as soon as two pages are hidden', 5, 20, [1, ELLIPSIS, 4, 5, 6, ELLIPSIS, 20]],
    ['the last page before an ellipsis', 17, 20, [1, ELLIPSIS, 16, 17, 18, 19, 20]],
    ['an ellipsis before the end', 20, 20, [1, ELLIPSIS, 19, 20]],
    ['an ellipsis before the second to last page', 19, 20, [1, ELLIPSIS, 18, 19, 20]],
  ])('shows %s (page %p of %p)', (_label, page, pageCount, expected) => {
    expect(pageWindow({ page, pageCount })).toStrictEqual(expected);
  });

  it.each<[string, number, number, number, PageWindowItem[]]>([
    ['no sibling in the middle', 10, 20, 0, [1, ELLIPSIS, 10, ELLIPSIS, 20]],
    ['no sibling on the first page', 1, 5, 0, [1, ELLIPSIS, 5]],
    ['no sibling on the last page', 5, 5, 0, [1, ELLIPSIS, 5]],
    ['no sibling on page 2', 2, 5, 0, [1, 2, ELLIPSIS, 5]],
    ['no sibling with one hidden page each side', 3, 5, 0, [1, 2, 3, 4, 5]],
    ['no sibling on the last of three pages', 3, 3, 0, [1, 2, 3]],
    ['no sibling on the first of three pages', 1, 3, 0, [1, 2, 3]],
    ['two siblings in the middle', 10, 20, 2, [1, ELLIPSIS, 8, 9, 10, 11, 12, ELLIPSIS, 20]],
    ['two siblings near the start', 3, 20, 2, [1, 2, 3, 4, 5, ELLIPSIS, 20]],
    ['more siblings than pages', 4, 8, 50, [1, 2, 3, 4, 5, 6, 7, 8]],
    ['negative siblings as none', 10, 20, -3, [1, ELLIPSIS, 10, ELLIPSIS, 20]],
    ['fractional siblings truncated', 10, 20, 1.9, [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]],
    ['NaN siblings as the default', 10, 20, Number.NaN, [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]],
    [
      'infinite siblings as the default',
      10,
      20,
      Number.POSITIVE_INFINITY,
      [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20],
    ],
  ])('shows %s (page %p of %p, siblings %p)', (_label, page, pageCount, siblings, expected) => {
    expect(pageWindow({ page, pageCount, siblings })).toStrictEqual(expected);
  });

  it.each<[string, number, number, PageWindowItem[]]>([
    ['page 0 as the first page', 0, 20, [1, 2, ELLIPSIS, 20]],
    ['a negative page as the first page', -5, 20, [1, 2, ELLIPSIS, 20]],
    ['a page after the last one as the last page', 99, 20, [1, ELLIPSIS, 19, 20]],
    ['NaN as the first page', Number.NaN, 20, [1, 2, ELLIPSIS, 20]],
    ['a fractional page truncated', 10.8, 20, [1, ELLIPSIS, 9, 10, 11, ELLIPSIS, 20]],
    ['a fractional page count truncated', 1, 3.9, [1, 2, 3]],
  ])('clamps %s (page %p of %p)', (_label, page, pageCount, expected) => {
    expect(pageWindow({ page, pageCount })).toStrictEqual(expected);
  });

  it.each([
    ['no page', 0],
    ['a negative page count', -4],
    ['a NaN page count', Number.NaN],
    ['an infinite page count', Number.POSITIVE_INFINITY],
    ['a page count below one', 0.5],
  ])('is empty with %s', (_label, pageCount) => {
    expect(pageWindow({ page: 1, pageCount })).toStrictEqual([]);
  });

  // every combination up to 30 pages and 3 siblings keeps the window's invariants
  it('keeps its invariants for every page, page count and sibling count', () => {
    const MAX_PAGE_COUNT = 30;
    const MAX_SIBLINGS = 3;
    const MIN_HIDDEN_FOR_ELLIPSIS = 2;
    const violations: string[] = [];

    for (let pageCount = 1; pageCount <= MAX_PAGE_COUNT; pageCount += 1) {
      for (let page = 1; page <= pageCount; page += 1) {
        for (let siblings = 0; siblings <= MAX_SIBLINGS; siblings += 1) {
          const items = pageWindow({ page, pageCount, siblings });
          const pages = items.filter((item): item is number => item !== ELLIPSIS);
          const fail = (reason: string) => {
            violations.push(
              `page ${String(page)} of ${String(pageCount)}, siblings ${String(siblings)}: ${reason}`,
            );
          };

          if (pages[0] !== FIRST_PAGE || pages.at(-1) !== pageCount) {
            fail('first or last page missing');
          }
          const nearStart = Math.max(FIRST_PAGE, page - siblings);
          const nearEnd = Math.min(pageCount, page + siblings);
          for (let near = nearStart; near <= nearEnd; near += 1) {
            if (!pages.includes(near)) {
              fail(`page ${String(near)} near the current page missing`);
            }
          }
          items.forEach((item, index) => {
            const before = items[index - 1];
            const after = items[index + 1];
            if (item === ELLIPSIS) {
              const hidesEnough =
                typeof before === 'number' &&
                typeof after === 'number' &&
                after - before - 1 >= MIN_HIDDEN_FOR_ELLIPSIS;
              if (!hidesEnough) {
                fail(`ellipsis at ${String(index)} does not hide two pages or more`);
              }
            } else if (typeof before === 'number' && item !== before + 1) {
              fail(`page ${String(item)} does not follow page ${String(before)}`);
            }
          });
        }
      }
    }

    expect(violations).toStrictEqual([]);
  });
});
