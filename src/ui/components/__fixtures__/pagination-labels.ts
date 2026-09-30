import type { PaginationLabels } from '../Pagination';

// english labels shared by the Pagination tests
export const PAGINATION_LABELS: PaginationLabels = {
  previous: 'Previous page',
  next: 'Next page',
  jumpTo: 'Go to page',
  jumpSubmit: 'Go',
  page: (page) => `Page ${String(page)}`,
  currentPage: (page, pageCount) => `Page ${String(page)} of ${String(pageCount)}, current page`,
  ellipsis: 'More pages',
};
