// pure pagination helpers of the Pagination primitive (FR-04): the window of page numbers around
// the current page, and page clamping and parsing for the jump-to-page field. pages are 1-based

export const FIRST_PAGE = 1;

/** pages shown on each side of the current page */
export const DEFAULT_SIBLINGS = 1;

export type PageWindowItem = number | 'ellipsis';

export interface PageWindowParams {
  page: number;
  pageCount: number;
  siblings?: number;
}

// an ellipsis stands for two hidden pages or more: a single hidden page is shown instead, since
// the ellipsis would take the same room
const MIN_HIDDEN_FOR_ELLIPSIS = 2;

const DIGITS_ONLY = /^\d+$/;
const DECIMAL_RADIX = 10;

/** the page count as a whole number of pages, at least 0 (0 when not finite) */
export const toPageCount = (pageCount: number): number =>
  Number.isFinite(pageCount) ? Math.max(0, Math.trunc(pageCount)) : 0;

/**
 * the page nearest to `page` within 1..pageCount: a fractional page is truncated, a non-finite page
 * goes to the first page. with no page at all (pageCount < 1) the first page is returned
 */
export const clampPage = (page: number, pageCount: number): number => {
  const last = Math.max(FIRST_PAGE, toPageCount(pageCount));
  if (!Number.isFinite(page)) {
    return FIRST_PAGE;
  }
  return Math.min(last, Math.max(FIRST_PAGE, Math.trunc(page)));
};

/**
 * the page typed in the jump-to-page field, clamped to 1..pageCount, or null when the text is not
 * a whole number (empty, signs, decimals, letters) or there is no page
 */
export const parsePageInput = (text: string, pageCount: number): number | null => {
  const trimmed = text.trim();
  if (!DIGITS_ONLY.test(trimmed) || toPageCount(pageCount) < FIRST_PAGE) {
    return null;
  }
  return clampPage(Number.parseInt(trimmed, DECIMAL_RADIX), pageCount);
};

/**
 * the page buttons to show: always the first and last pages, the current page with `siblings`
 * pages on each side, and 'ellipsis' for each run of two hidden pages or more.
 * e.g. page 10 of 20 with one sibling: [1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]
 */
export const pageWindow = ({
  page,
  pageCount,
  siblings = DEFAULT_SIBLINGS,
}: PageWindowParams): PageWindowItem[] => {
  const last = toPageCount(pageCount);
  if (last < FIRST_PAGE) {
    return [];
  }
  const current = clampPage(page, last);
  const around = Number.isFinite(siblings) ? Math.max(0, Math.trunc(siblings)) : DEFAULT_SIBLINGS;
  // the pages around the current one, without the first and last pages
  const start = Math.max(FIRST_PAGE + 1, current - around);
  const end = Math.min(last - 1, current + around);

  const items: PageWindowItem[] = [FIRST_PAGE];
  const hiddenBefore = start - (FIRST_PAGE + 1);
  if (hiddenBefore >= MIN_HIDDEN_FOR_ELLIPSIS) {
    items.push('ellipsis');
  } else {
    for (let hidden = FIRST_PAGE + 1; hidden < start; hidden += 1) {
      items.push(hidden);
    }
  }
  for (let shown = start; shown <= end; shown += 1) {
    items.push(shown);
  }
  const hiddenAfter = last - 1 - Math.max(end, FIRST_PAGE);
  if (hiddenAfter >= MIN_HIDDEN_FOR_ELLIPSIS) {
    items.push('ellipsis');
  } else {
    for (let hidden = Math.max(end, FIRST_PAGE) + 1; hidden < last; hidden += 1) {
      items.push(hidden);
    }
  }
  if (last > FIRST_PAGE) {
    items.push(last);
  }
  return items;
};
