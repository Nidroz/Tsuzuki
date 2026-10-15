// the adult content filter of BR-06 as a query `select` (docs/ARCHITECTURE.md §6 and §7): it runs
// on cached data, so toggling the setting never refetches
import type { Page } from '../catalog/catalog-provider';
import { applyContentFilter } from '../domain/content-filter';

/** a page of the visible items, with the number of adult items hidden from it */
export interface FilteredPage<T> extends Page<T> {
  readonly hiddenCount: number;
}

interface Filterable {
  readonly isAdult: boolean;
}

/** the `select` of a catalog page query */
export type SelectFilteredPage = <T extends Filterable>(page: Page<T>) => FilteredPage<T>;

const filterPage = <T extends Filterable>(page: Page<T>, showAdult: boolean): FilteredPage<T> => {
  const { items, hiddenCount } = applyContentFilter(page.items, showAdult);
  return { ...page, items, hiddenCount };
};

// module level: one stable function per setting value, so a query reruns the selection only when
// its data or the setting changes
const keepAdult: SelectFilteredPage = (page) => filterPage(page, true);
const hideAdult: SelectFilteredPage = (page) => filterPage(page, false);

/** the `select` of a catalog page query for the adult content setting `showAdult` (BR-06) */
export const selectFilteredPage = (showAdult: boolean): SelectFilteredPage =>
  showAdult ? keepAdult : hideAdult;
