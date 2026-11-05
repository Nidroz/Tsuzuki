import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { createDeferred } from '../../../test/core/fake-library-repository';
import {
  LIBRARY_KEY,
  renderSyncIssues,
  settle,
} from '../../../test/core/library-sync-issues-support';
import { createStuckAccount } from '../../../test/core/stuck-account';
import type { LibraryReplayRun } from '../repositories/library-repository';
import { PENDING_LIBRARY_REPOSITORY } from './pending-library';
import { LIBRARY_SYNC_ISSUES_REPORT_SOURCE } from './use-library-sync-issues';

// per ADR-0017 "Stuck writes" (update of 2026-11-04): the stuck writes of the live account library,
// their retry and their discard

const CONFIRMED_ONE: LibraryReplayRun = { status: 'done', confirmed: 1 };
const CONFIRMED_NONE: LibraryReplayRun = { status: 'failed', confirmed: 0 };
const SIGNED_OUT: LibraryReplayRun = { status: 'signed-out', confirmed: 0 };

describe('useLibrarySyncIssues while the live library is not the account library', () => {
  it('counts nothing and does nothing signed out', async () => {
    const { result, invalidate } = renderSyncIssues({ account: null });

    expect(result.current.stuckCount).toBe(0);
    expect(result.current.retrying).toBe(false);
    act(() => {
      result.current.retry();
    });
    expect(result.current.retrying).toBe(false);
    expect(result.current.discard()).toBe(0);
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never reads, retries or discards the account while its guest merge is pending', async () => {
    const { account } = createStuckAccount(2);
    const { result, invalidate } = renderSyncIssues({ account, live: PENDING_LIBRARY_REPOSITORY });

    expect(result.current.stuckCount).toBe(0);
    act(() => {
      result.current.retry();
    });
    expect(result.current.discard()).toBe(0);
    await settle();

    expect(account.stuckWriteCount).not.toHaveBeenCalled();
    expect(account.subscribeToSyncState).not.toHaveBeenCalled();
    expect(account.retryStuckWrites).not.toHaveBeenCalled();
    expect(account.discardStuckWrites).not.toHaveBeenCalled();
    expect(result.current.retrying).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('useLibrarySyncIssues on the live account library', () => {
  it('reads the stuck count and follows each sync state notification', () => {
    const stuck = createStuckAccount(2);
    const { result, unmount } = renderSyncIssues({ account: stuck.account });

    expect(result.current.stuckCount).toBe(2);
    expect(stuck.listenerCount()).toBe(1);

    act(() => {
      stuck.setStuckCount(1);
    });
    expect(result.current.stuckCount).toBe(1);

    act(() => {
      stuck.setStuckCount(0);
    });
    expect(result.current.stuckCount).toBe(0);

    unmount();
    expect(stuck.listenerCount()).toBe(0);
  });

  it('retries once at a time, pending until the run settled, and refetches the library after a run that confirmed writes', async () => {
    const { account } = createStuckAccount(1);
    const run = createDeferred<LibraryReplayRun>();
    account.retryStuckWrites.mockReturnValueOnce(run.promise);
    const { result, invalidate } = renderSyncIssues({ account });

    act(() => {
      result.current.retry();
      result.current.retry();
    });
    expect(result.current.retrying).toBe(true);
    act(() => {
      result.current.retry();
    });
    expect(account.retryStuckWrites).toHaveBeenCalledTimes(1);
    expect(account.retryStuckWrites).toHaveBeenCalledWith();

    await act(async () => {
      run.resolve(CONFIRMED_ONE);
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.retrying).toBe(false);
    expect(invalidate.mock.calls).toStrictEqual([[{ queryKey: LIBRARY_KEY }]]);
  });

  it('refetches nothing after a retry run that confirmed nothing, and retries again after it', async () => {
    const { account } = createStuckAccount(1);
    account.retryStuckWrites.mockResolvedValue(CONFIRMED_NONE);
    const { result, invalidate } = renderSyncIssues({ account });

    act(() => {
      result.current.retry();
    });
    await settle();
    act(() => {
      result.current.retry();
    });
    await settle();

    expect(account.retryStuckWrites).toHaveBeenCalledTimes(2);
    expect(result.current.retrying).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reports a retry that rejects with a fixed source, never throwing, and ends the pending state', async () => {
    const { account } = createStuckAccount(1);
    const failure = new Error('store bug');
    account.retryStuckWrites.mockRejectedValueOnce(failure);
    const { result, invalidate, captureError } = renderSyncIssues({ account });

    act(() => {
      result.current.retry();
    });
    await settle();

    expect(captureError.mock.calls).toStrictEqual([
      [failure, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE }],
    ]);
    expect(result.current.retrying).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never shows a retry of the previous account as pending, nor refetches the next one's library after it", async () => {
    const previous = createStuckAccount(1).account;
    const next = createStuckAccount(2).account;
    const run = createDeferred<LibraryReplayRun>();
    previous.retryStuckWrites.mockReturnValueOnce(run.promise);
    const { result, invalidate, switchTo } = renderSyncIssues({ account: previous });
    act(() => {
      result.current.retry();
    });

    switchTo(next);

    expect(result.current.stuckCount).toBe(2);
    expect(result.current.retrying).toBe(false);
    next.retryStuckWrites.mockReturnValueOnce(new Promise<LibraryReplayRun>(() => undefined));
    act(() => {
      result.current.retry();
    });
    expect(next.retryStuckWrites).toHaveBeenCalledTimes(1);
    expect(result.current.retrying).toBe(true);

    await act(async () => {
      run.resolve(CONFIRMED_ONE);
      await jest.advanceTimersByTimeAsync(0);
    });

    // the retry of the next account still runs
    expect(result.current.retrying).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('discards the stuck writes, returns how many went and refetches the library', () => {
    const { account } = createStuckAccount(2);
    account.discardStuckWrites.mockReturnValueOnce(2);
    const { result, invalidate } = renderSyncIssues({ account });

    expect(result.current.discard()).toBe(2);

    expect(account.discardStuckWrites).toHaveBeenCalledTimes(1);
    expect(invalidate.mock.calls).toStrictEqual([[{ queryKey: LIBRARY_KEY }]]);
  });

  it('refetches nothing when the discard removed nothing', () => {
    const { account } = createStuckAccount(1);
    const { result, invalidate } = renderSyncIssues({ account });

    expect(result.current.discard()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reports a discard whose storage failed with a fixed source, and returns 0', () => {
    const { account } = createStuckAccount(1);
    const failure = new Error('storage failed');
    account.discardStuckWrites.mockImplementationOnce(() => {
      throw failure;
    });
    const { result, invalidate, captureError } = renderSyncIssues({ account });

    expect(result.current.discard()).toBe(0);

    expect(captureError.mock.calls).toStrictEqual([
      [failure, { source: LIBRARY_SYNC_ISSUES_REPORT_SOURCE }],
    ]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(result.current.stuckCount).toBe(1);
  });
});

describe('useLibrarySyncIssues over an instance the purge closed', () => {
  it('counts nothing, refetches nothing and reports nothing', async () => {
    const { account } = createStuckAccount(1);
    const { result, rerender, invalidate, captureError } = renderSyncIssues({ account });
    expect(result.current.stuckCount).toBe(1);

    // the contract of a closed instance: no stuck write, a signed-out run, nothing discarded
    account.stuckWriteCount.mockReturnValue(0);
    account.retryStuckWrites.mockResolvedValue(SIGNED_OUT);
    account.discardStuckWrites.mockReturnValue(0);
    rerender();

    expect(result.current.stuckCount).toBe(0);
    act(() => {
      result.current.retry();
    });
    expect(result.current.retrying).toBe(true);
    await settle();
    expect(result.current.retrying).toBe(false);
    expect(result.current.discard()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });
});
