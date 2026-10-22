// the rendered useSearch hook and the pages of a search of LAST_PAGE pages, for the tests of the
// next page prefetch (use-prefetch-next-page*.test.tsx)
import { renderHook } from '@testing-library/react';

import { createFakeCatalogProvider } from '../../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogRequestOptions, SearchParams } from '../../catalog/catalog-provider';
import { createQueryClient } from '../../query/query-client';
import { useSearch } from '../use-search';
import { hookWrapper, pageNumber } from './catalog-pages';
import type { Search } from './search-hook';

export { LAST_PAGE, pageNumber, settle, summaryOf } from './catalog-pages';
export { searchPendingUntilAborted, type Search } from './search-hook';

/** the request options of a prefetch */
export const BACKGROUND: CatalogRequestOptions = { priority: 'background' };

/** page `page` of the frieren search: pageNumber(page) answers it */
export const frieren = (page: number): SearchParams => ({ kind: 'anime', query: 'frieren', page });
export const MUSHISHI: SearchParams = { kind: 'anime', query: 'mushishi', page: 1 };

/** foreground requests answer their page at once (pageNumber), background ones run `background` */
export const answering =
  (background: Search): Search =>
  (params, signal, options) =>
    options?.priority === 'background'
      ? background(params, signal, options)
      : Promise.resolve(pageNumber(params.page));

/** useSearch of `params`, the adult titles hidden, on a fake provider answering with `search` */
export const setupPrefetch = (params: SearchParams | null, search: Search) => {
  const provider = createFakeCatalogProvider();
  provider.search.mockImplementation(search);
  const queryClient = createQueryClient();
  const hook = renderHook(
    ({ params: current }: { readonly params: SearchParams | null }) =>
      useSearch(current, { showAdult: false }),
    { initialProps: { params }, wrapper: hookWrapper(queryClient, provider) },
  );
  return { provider, queryClient, ...hook };
};

/** the prefetches the provider received, in order */
export const backgroundCalls = (provider: ReturnType<typeof createFakeCatalogProvider>) =>
  provider.search.mock.calls.filter(([, , options]) => options?.priority === 'background');
