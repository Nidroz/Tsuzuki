import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act } from '@testing-library/react';

import { holdNextCall } from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import { LibraryRemoteError } from '../errors/library-errors';
import { LibraryFailureError } from '../errors/library-report-errors';
import {
  ACCOUNT_ENTRIES,
  CLEAN,
  fullMergeOf,
  MANGA,
  renderRoom,
  settle,
} from '../../../test/core/guest-merge-room-support';
import { GUEST_MERGE_ROOM_REPORT_SOURCE } from './use-guest-merge-room';

// per R-09: a removal from the account library, the only write while the guest merge is refused
// at the cap, then the merge retried; one at a time

const REPORT = [new LibraryFailureError('guest-merge'), { source: GUEST_MERGE_ROOM_REPORT_SOURCE }];

afterEach(() => {
  // the onlineManager is one module instance for the whole file
  onlineManager.setOnline(true);
});

// the hook with its entries read
const renderReady = async (...args: Parameters<typeof renderRoom>) => {
  const rendered = renderRoom(...args);
  await settle();
  expect(rendered.result.current.status).toBe('ready');
  return rendered;
};

describe('useGuestMergeRoom: a removal', () => {
  it('removes the entry from the account, then retries the merge, busy until it restarts', async () => {
    const merge = fullMergeOf();
    const rendered = await renderReady({ merge });

    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    expect(rendered.result.current).toMatchObject({ busy: true, removingKey: CLEAN.key });
    expect(merge.retry).not.toHaveBeenCalled();
    await settle();

    expect(rendered.account?.remove).toHaveBeenCalledWith(CLEAN.key);
    expect(rendered.account?.stored(CLEAN.key)).toBeNull();
    expect(merge.retry).toHaveBeenCalledTimes(1);
    // nothing else written: the only write is the removal
    expect(rendered.account?.save).not.toHaveBeenCalled();
    expect(rendered.account?.mergeGuestEntries).not.toHaveBeenCalled();
    expect(rendered.result.current).toMatchObject({ busy: true, removingKey: null, failure: null });

    // while the merge restarts, nothing else runs
    act(() => {
      rendered.result.current.remove(MANGA.key);
      rendered.result.current.retry();
    });
    expect(rendered.account?.remove).toHaveBeenCalledTimes(1);
    expect(merge.retry).toHaveBeenCalledTimes(1);

    // refused again: a new refusal, free again
    rendered.setMerge(fullMergeOf());
    expect(rendered.result.current.busy).toBe(false);
    await settle();
  });

  it('runs one removal at a time: a second tap meanwhile is ignored', async () => {
    const merge = fullMergeOf();
    const rendered = await renderReady({ merge });
    const held = holdNextCall(rendered.account ?? createStuckAccount(0).account, 'remove');

    act(() => {
      rendered.result.current.remove(CLEAN.key);
      rendered.result.current.remove(MANGA.key);
    });
    act(() => {
      rendered.result.current.remove(MANGA.key);
      rendered.result.current.retry();
    });
    await act(async () => {
      held.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.account?.remove.mock.calls).toStrictEqual([[CLEAN.key]]);
    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('gives the merge its Try again while nothing runs', async () => {
    const merge = fullMergeOf();
    const rendered = await renderReady({ merge });

    act(() => {
      rendered.result.current.retry();
    });

    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('retries nothing once the session moved on during the removal', async () => {
    const merge = fullMergeOf();
    const rendered = await renderReady({ merge });
    const held = holdNextCall(rendered.account ?? createStuckAccount(0).account, 'remove');
    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });

    rendered.setAccount(null);
    await act(async () => {
      held.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(merge.retry).not.toHaveBeenCalled();
    expect(rendered.result.current).toMatchObject({ active: false, busy: false });
  });
});

describe('useGuestMergeRoom: a removal that did not happen', () => {
  it('writes nothing offline and says so, each time anew', async () => {
    const merge = fullMergeOf();
    const rendered = await renderReady({ merge });
    onlineManager.setOnline(false);

    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    expect(rendered.result.current).toMatchObject({ failure: 'offline', busy: false });
    const { failureId } = rendered.result.current;
    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });

    expect(rendered.result.current.failure).toBe('offline');
    expect(rendered.result.current.failureId).toBe(failureId + 1);
    expect(rendered.account?.remove).not.toHaveBeenCalled();
    expect(merge.retry).not.toHaveBeenCalled();
  });

  it('says offline and retries nothing for a removal the server did not confirm (kept queued)', async () => {
    const merge = fullMergeOf();
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    // the offline account library keeps a removal it could not send in its queue
    account.remove.mockImplementationOnce(() => {
      account.queuedWriteCount.mockReturnValue(1);
      return Promise.resolve();
    });
    const rendered = await renderReady({ merge, account });

    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    await settle();

    expect(rendered.result.current).toMatchObject({ failure: 'offline', busy: false });
    expect(merge.retry).not.toHaveBeenCalled();
    expect(rendered.captureError).not.toHaveBeenCalled();

    // sent again, confirmed this time: one queued write fewer, the merge retried
    account.queuedWriteCount.mockReturnValue(0);
    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    expect(rendered.result.current.failure).toBeNull();
    await settle();

    expect(merge.retry).toHaveBeenCalledTimes(1);
  });

  it('says a refused removal failed, unreported: the account store reports its own', async () => {
    const merge = fullMergeOf();
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    const rendered = await renderReady({ merge, account });
    account.beforeCall.mockRejectedValueOnce(new LibraryRemoteError('rejected'));

    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    await settle();

    expect(rendered.result.current).toMatchObject({ failure: 'failed', busy: false });
    expect(rendered.captureError).not.toHaveBeenCalled();
    expect(merge.retry).not.toHaveBeenCalled();
    expect(account.stored(CLEAN.key)).toStrictEqual(CLEAN);
  });

  it('reports an unexpected removal failure as a fixed error only', async () => {
    const merge = fullMergeOf();
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    const rendered = await renderReady({ merge, account });
    const failure = new Error('storage failed near "rewatch the finale"');
    account.beforeCall.mockRejectedValueOnce(failure);

    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    await settle();

    expect(rendered.result.current.failure).toBe('failed');
    expect(rendered.captureError.mock.calls).toStrictEqual([REPORT]);
    expect(rendered.captureError.mock.calls.flat()).not.toContain(failure);
    expect(merge.retry).not.toHaveBeenCalled();
  });

  it('shows the failure of this refusal only', async () => {
    const rendered = await renderReady();
    onlineManager.setOnline(false);
    act(() => {
      rendered.result.current.remove(CLEAN.key);
    });
    expect(rendered.result.current.failure).toBe('offline');

    rendered.setMerge(fullMergeOf());

    expect(rendered.result.current.failure).toBeNull();
    await settle();
  });
});
