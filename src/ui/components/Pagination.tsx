import { useCallback } from 'react';

import { IconButton } from './IconButton';
import { JumpToPage } from './pagination/JumpToPage';
import { PageButton, PageEllipsis } from './pagination/PageButton';
import {
  clampPage,
  DEFAULT_SIBLINGS,
  FIRST_PAGE,
  pageWindow,
  toPageCount,
} from './pagination/page-window';
import { Row } from './Row';
import { Stack } from './Stack';

/** translated labels: src/ui never translates */
export interface PaginationLabels {
  /** previous page button, e.g. "Previous page" */
  previous: string;
  /** next page button, e.g. "Next page" */
  next: string;
  /** jump-to-page field label, e.g. "Go to page" */
  jumpTo: string;
  /** jump-to-page submit button, e.g. "Go" */
  jumpSubmit: string;
  /** accessibility label of a page button, e.g. (3) => "Page 3" */
  page: (page: number) => string;
  /** accessibility label of the current page, e.g. (3, 12) => "Page 3 of 12, current page" */
  currentPage: (page: number, pageCount: number) => string;
  /** accessibility label of an ellipsis, e.g. "More pages" */
  ellipsis: string;
}

export interface PaginationProps {
  /** the current page, 1-based */
  page: number;
  pageCount: number;
  /** called with the requested page, never with the current one */
  onPageChange: (page: number) => void;
  labels: PaginationLabels;
  /** pages shown on each side of the current page; DEFAULT_SIBLINGS by default */
  siblings?: number;
  /**
   * derived ids for tests: `${testID}-previous`, `${testID}-next`, `${testID}-page-<n>`,
   * `${testID}-jump-input` and `${testID}-jump-submit`
   */
  testID?: string;
}

/**
 * page navigation (FR-04): previous and next buttons, a window of page numbers with ellipses, and
 * a jump-to-page field. with one page or none there is nowhere to go, so nothing is rendered: the
 * caller never has to hide it itself
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  labels,
  siblings = DEFAULT_SIBLINGS,
  testID,
}: PaginationProps) {
  const total = toPageCount(pageCount);
  const current = clampPage(page, total);

  const goTo = useCallback(
    (target: number) => {
      const next = clampPage(target, total);
      if (next !== current) {
        onPageChange(next);
      }
    },
    [current, total, onPageChange],
  );
  const goPrevious = useCallback(() => {
    goTo(current - 1);
  }, [goTo, current]);
  const goNext = useCallback(() => {
    goTo(current + 1);
  }, [goTo, current]);

  if (total <= FIRST_PAGE) {
    return null;
  }

  const id = (suffix: string) => (testID === undefined ? {} : { testID: `${testID}-${suffix}` });
  const items = pageWindow({ page: current, pageCount: total, siblings });

  return (
    <Stack gap="sm" {...(testID !== undefined && { testID })}>
      <Row gap="xs" justify="center" wrap>
        <IconButton
          icon="chevron-back"
          accessibilityLabel={labels.previous}
          onPress={goPrevious}
          disabled={current <= FIRST_PAGE}
          {...id('previous')}
        />
        {items.map((item, index) =>
          item === 'ellipsis' ? (
            // at most two ellipses, told apart by the page before them
            <PageEllipsis
              key={`ellipsis-${String(items[index - 1])}`}
              accessibilityLabel={labels.ellipsis}
            />
          ) : (
            <PageButton
              key={item}
              page={item}
              selected={item === current}
              accessibilityLabel={
                item === current ? labels.currentPage(item, total) : labels.page(item)
              }
              onSelect={goTo}
              {...id(`page-${String(item)}`)}
            />
          ),
        )}
        <IconButton
          icon="chevron-forward"
          accessibilityLabel={labels.next}
          onPress={goNext}
          disabled={current >= total}
          {...id('next')}
        />
      </Row>
      <JumpToPage
        page={current}
        pageCount={total}
        onPageChange={onPageChange}
        label={labels.jumpTo}
        submitLabel={labels.jumpSubmit}
        {...(testID !== undefined && {
          inputTestID: `${testID}-jump-input`,
          submitTestID: `${testID}-jump-submit`,
        })}
      />
    </Stack>
  );
}
