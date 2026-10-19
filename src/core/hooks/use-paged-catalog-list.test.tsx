import { describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogRequestOptions, MediaSummary, Page } from '../catalog/catalog-provider';
import { createQueryClient } from '../query/query-client';
import { STALE_TIMES } from '../query/stale-times';
import {
  hookWrapper,
  pageAnsweredByTest,
  pageNumber,
  pendingUntilAborted,
  settle,
} from './__fixtures__/catalog-pages';
import {
  LIST_KEY_PAGE,
  usePagedCatalogList,
  type CatalogListPlaceholder,
  type CatalogPageList,
  type CatalogPageRequest,
} from './use-paged-catalog-list';

type FetchPage = (
  page: number,
  signal: AbortSignal,
  options?: CatalogRequestOptions,
) => Promise<Page<MediaSummary>>;

// pages answered at once in the foreground (ids from `idBase`); a background request runs `background`
const answering =
  (idBase: number, background: FetchPage = (_page, signal) => pendingUntilAborted(signal)) =>
  (page: number, signal: AbortSignal, options?: CatalogRequestOptions) =>
    options?.priority === 'background'
      ? background(page, signal, options)
      : Promise.resolve(pageNumber(page, idBase));

// a list under its own key root, so no query defaults apply
const listOf = (name: string, fetchPage: FetchPage) => {
  const fetch = jest.fn<FetchPage>(fetchPage);
  const list: CatalogPageList = {
    listKey: ['test-list', name, LIST_KEY_PAGE],
    pageKey: (page) => ['test-list', name, page],
    fetchPage: fetch,
    staleTime: STALE_TIMES.top,
  };
  return { list, fetch };
};

const IDLE: CatalogPageRequest = { list: null, idleKey: ['test-list', 'idle'] };
const SECOND_LIST_ID_BASE = 100;

interface HookProps {
  readonly request: CatalogPageRequest;
}

const setup = (request: CatalogPageRequest, placeholder: CatalogListPlaceholder) =>
  renderHook(
    ({ request: current }: HookProps) =>
      usePagedCatalogList(current, { showAdult: false, placeholder }),
    {
      initialProps: { request },
      wrapper: hookWrapper(createQueryClient(), createFakeCatalogProvider()),
    },
  );

describe('usePagedCatalogList', () => {
  it('fetches nothing and shows no placeholder for an idle request', async () => {
    const first = listOf('first', answering(0));
    const { result, rerender } = setup({ list: first.list, page: 1 }, 'previous-key');
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    rerender({ request: IDLE });
    await settle();

    expect(result.current.query.fetchStatus).toBe('idle');
    expect(result.current.query.data).toBeUndefined();
    expect(result.current.query.isPlaceholderData).toBe(false);
    expect(result.current.isPlaceholderFromOtherList).toBe(false);
    expect(first.fetch).toHaveBeenCalledTimes(2);
  });

  it('previous-key: keeps another list as placeholder and says so until its own page arrives', async () => {
    const first = listOf('first', answering(0));
    const second = pageAnsweredByTest();
    const other = listOf('second', second.request);
    const { result, rerender } = setup({ list: first.list, page: 1 }, 'previous-key');
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    rerender({ request: { list: other.list, page: 1 } });
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual(pageNumber(1).items);
    expect(result.current.isPlaceholderFromOtherList).toBe(true);

    second.answer(pageNumber(1, SECOND_LIST_ID_BASE));
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(false);
    expect(result.current.query.data?.items).toStrictEqual(
      pageNumber(1, SECOND_LIST_ID_BASE).items,
    );
    expect(result.current.isPlaceholderFromOtherList).toBe(false);
  });

  it('previous-key: a page of the same list is not from another list, until the list changes', async () => {
    const first = listOf('first', answering(0));
    const other = listOf('second', (_page, signal) => pendingUntilAborted(signal));
    const { result, rerender } = setup({ list: first.list, page: 1 }, 'previous-key');
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    first.fetch.mockImplementation((_page, signal) => pendingUntilAborted(signal));

    rerender({ request: { list: first.list, page: 2 } });
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.isPlaceholderFromOtherList).toBe(false);

    rerender({ request: { list: other.list, page: 1 } });
    await settle();

    expect(result.current.query.data?.items).toStrictEqual(pageNumber(1).items);
    expect(result.current.isPlaceholderFromOtherList).toBe(true);
  });

  it('same-list: keeps the page before on a page change, never on a list change', async () => {
    const first = listOf('first', answering(0));
    const other = listOf('second', (_page, signal) => pendingUntilAborted(signal));
    const { result, rerender } = setup({ list: first.list, page: 1 }, 'same-list');
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    first.fetch.mockImplementation((_page, signal) => pendingUntilAborted(signal));

    rerender({ request: { list: first.list, page: 2 } });
    await settle();

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual(pageNumber(1).items);
    expect(result.current.isPlaceholderFromOtherList).toBe(false);

    // the page shown is still a placeholder: tanstack would reuse it with the same function
    rerender({ request: { list: other.list, page: 1 } });

    expect(result.current.query.isPlaceholderData).toBe(false);
    expect(result.current.query.data).toBeUndefined();
    expect(result.current.isPlaceholderFromOtherList).toBe(false);

    await settle();

    expect(result.current.query.isPending).toBe(true);
    expect(result.current.query.data).toBeUndefined();
  });

  it('keys the prefetch abort on the list key, not on the descriptor object', async () => {
    const first = listOf('first', answering(0));
    const { result, rerender } = setup({ list: first.list, page: 1 }, 'same-list');
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    await settle();
    const background = first.fetch.mock.calls.filter(([, , options]) => options !== undefined);
    expect(background).toStrictEqual([[2, expect.any(AbortSignal), { priority: 'background' }]]);
    const prefetchSignal = background[0]?.[1];

    // an equal list in a new descriptor
    rerender({ request: { list: { ...first.list }, page: 1 } });
    await settle();

    expect(prefetchSignal?.aborted).toBe(false);
    expect(result.current.query.data?.page).toBe(1);

    rerender({ request: IDLE });
    await settle();

    expect(prefetchSignal?.aborted).toBe(true);
  });
});
