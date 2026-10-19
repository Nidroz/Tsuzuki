import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider, MediaSummary, Page } from '../catalog/catalog-provider';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { STALE_TIMES } from '../query/stale-times';
import {
  hookWrapper,
  LAST_PAGE,
  pageNumber,
  pendingUntilAborted,
  settle,
  summaryOf,
} from './__fixtures__/catalog-pages';
import { useCurrentSeason } from './use-current-season';

type GetCurrentSeason = CatalogProvider['getCurrentSeason'];

// foreground requests answer their page at once, background ones never settle by themselves
const answering: GetCurrentSeason = (page, signal, options) =>
  options?.priority === 'background'
    ? pendingUntilAborted(signal)
    : Promise.resolve(pageNumber(page));

const setup = (page: number, getCurrentSeason: GetCurrentSeason = answering) => {
  const provider = createFakeCatalogProvider();
  provider.getCurrentSeason.mockImplementation(getCurrentSeason);
  const queryClient = createQueryClient();
  const hook = renderHook(
    ({ page: current }: { readonly page: number }) =>
      useCurrentSeason(current, { showAdult: false }),
    { initialProps: { page }, wrapper: hookWrapper(queryClient, provider) },
  );
  return { provider, queryClient, ...hook };
};

describe('useCurrentSeason', () => {
  it('fetches the season page with the query signal under the season key', async () => {
    const { provider, queryClient, result } = setup(1);

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(provider.getCurrentSeason).toHaveBeenNthCalledWith(1, 1, expect.any(AbortSignal));
    expect(queryClient.getQueryData(queryKeys.season('mal', 1))).toStrictEqual(pageNumber(1));
    expect(result.current.query.data).toStrictEqual({ ...pageNumber(1), hiddenCount: 0 });
  });

  it('keeps pages fresh for STALE_TIMES.season', async () => {
    const { result } = setup(1);
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    expect(result.current.query.isStale).toBe(false);
    const freshUntil = result.current.query.dataUpdatedAt + STALE_TIMES.season;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(freshUntil - Date.now() - 1);
    });

    expect(result.current.query.isStale).toBe(false);
    await waitFor(() => {
      expect(result.current.query.isStale).toBe(true);
    });
  });

  it('BR-06: hides adult titles and counts them', async () => {
    const page: Page<MediaSummary> = {
      ...pageNumber(1),
      items: [summaryOf(1, 'anime', true), summaryOf(2), summaryOf(3, 'anime', true)],
    };
    const { result } = setup(1, () => Promise.resolve(page));

    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    expect(result.current.query.data?.items).toStrictEqual([summaryOf(2)]);
    expect(result.current.query.data?.hiddenCount).toBe(2);
  });

  it('keeps the page before as placeholder while another page loads', async () => {
    const { provider, result, rerender } = setup(1);
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.getCurrentSeason.mockImplementation((_page, signal) => pendingUntilAborted(signal));

    rerender({ page: LAST_PAGE });
    await settle();

    expect(provider.getCurrentSeason).toHaveBeenLastCalledWith(LAST_PAGE, expect.any(AbortSignal));
    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.page).toBe(1);
    expect(result.current.isPlaceholderFromOtherList).toBe(false);
  });

  it('prefetches the next page in the background into its key', async () => {
    const { provider, queryClient } = setup(1, (page) => Promise.resolve(pageNumber(page)));

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.season('mal', 2))).toStrictEqual(pageNumber(2));
    });
    expect(provider.getCurrentSeason).toHaveBeenLastCalledWith(2, expect.any(AbortSignal), {
      priority: 'background',
    });
  });
});
