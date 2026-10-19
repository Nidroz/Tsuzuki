import { describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react';

import {
  CLEAN,
  FRIEREN,
  FRIEREN_MANGA,
  MONONOKE,
  MUSHISHI,
  OTHER,
  pageOf,
  resolvesWith,
  searchPendingUntilAborted as pendingUntilAborted,
  setupSearch as setup,
} from './__fixtures__/search-hook';
import { pageAnsweredByTest } from './__fixtures__/catalog-pages';

// useSearch when its key changes: the request it leaves is aborted, and the last settled results
// stay as placeholder data until the new ones come, never across an idle state

describe('useSearch key changes', () => {
  it('aborts the request of a key it leaves', async () => {
    const { provider, rerender } = setup(FRIEREN, pendingUntilAborted);
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(1);
    });
    const firstSignal = provider.search.mock.calls[0]?.[1];

    expect(firstSignal?.aborted).toBe(false);

    rerender({ params: FRIEREN_MANGA, showAdult: false });
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(2);
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(provider.search).toHaveBeenLastCalledWith(FRIEREN_MANGA, expect.any(AbortSignal));
    expect(provider.search.mock.calls[1]?.[1]?.aborted).toBe(false);
  });

  it('aborts a pending request when the params go back to null', async () => {
    const { provider, rerender, result } = setup(FRIEREN, pendingUntilAborted);
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(1);
    });

    rerender({ params: null, showAdult: false });

    await waitFor(() => {
      expect(provider.search.mock.calls[0]?.[1]?.aborted).toBe(true);
    });
    expect(result.current.query.fetchStatus).toBe('idle');
  });

  it('keeps the previous results as placeholder data while a new key loads', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.search.mockImplementation(pendingUntilAborted);

    rerender({ params: MUSHISHI, showAdult: false });

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);

    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(2);
    });

    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);
  });

  it('keeps the last settled results as placeholder data across two pending keys', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.search.mockImplementation(pendingUntilAborted);
    rerender({ params: MUSHISHI, showAdult: false });
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(2);
    });
    expect(result.current.query.isPlaceholderData).toBe(true);
    const third = pageAnsweredByTest();
    provider.search.mockImplementation(third.request);

    rerender({ params: MONONOKE, showAdult: false });

    // the placeholder function alone would drop these results: their key is not the one just
    // before. tanstack reuses the previous placeholder while `placeholderData` stays the same
    // function object, which is what keeps them
    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);

    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(3);
    });

    expect(provider.search).toHaveBeenLastCalledWith(MONONOKE, expect.any(AbortSignal));
    expect(result.current.query.isPlaceholderData).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual([CLEAN]);

    act(() => {
      third.answer(pageOf(OTHER));
    });

    await waitFor(() => {
      expect(result.current.query.isPlaceholderData).toBe(false);
    });
    expect(result.current.query.isSuccess).toBe(true);
    expect(result.current.query.data?.items).toStrictEqual([OTHER]);
  });

  it('shows no results while idle after a search', async () => {
    const { result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });

    rerender({ params: null, showAdult: false });

    expect(result.current.query.data).toBeUndefined();
    expect(result.current.query.isPlaceholderData).toBe(false);
  });

  it('keeps no results from before an idle state as placeholder data', async () => {
    const { provider, result, rerender } = setup(FRIEREN, resolvesWith(pageOf(CLEAN)));
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true);
    });
    provider.search.mockImplementation(pendingUntilAborted);
    rerender({ params: null, showAdult: false });

    rerender({ params: MUSHISHI, showAdult: false });

    expect(result.current.query.data).toBeUndefined();
    expect(result.current.query.isPlaceholderData).toBe(false);

    // the request starting updates the result again, after the new key is committed
    await waitFor(() => {
      expect(provider.search).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.query.isPending).toBe(true);
    expect(result.current.query.data).toBeUndefined();
    expect(result.current.query.isPlaceholderData).toBe(false);
  });
});
