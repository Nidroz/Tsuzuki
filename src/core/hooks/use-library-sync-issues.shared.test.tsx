import { describe, expect, it } from '@jest/globals';
import { act } from '@testing-library/react';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { renderSyncIssues, settle } from '../../../test/core/library-sync-issues-support';
import { createStuckAccount } from '../../../test/core/stuck-account';
import type { LibraryReplayRun } from '../repositories/offline-account-library-repository';

// per R-03: the retry state and the feedback of the stuck writes actions are shared by every hook
// of one account library instance (the library and favorites tabs stay mounted together)

const OFFLINE: LibraryReplayRun = { status: 'offline', confirmed: 0 };
const FAILED: LibraryReplayRun = { status: 'failed', confirmed: 0 };

const failingDiscard = () => {
  throw new Error('storage failed');
};

describe('useLibrarySyncIssues shared by the hooks of one instance', () => {
  it('starts one retry from two hooks and shows it pending in both until it settled', async () => {
    const { account } = createStuckAccount(1);
    const run = createDeferred<LibraryReplayRun>();
    account.retryStuckWrites.mockReturnValueOnce(run.promise);
    const library = renderSyncIssues({ account });
    const favorites = renderSyncIssues({ account });

    act(() => {
      library.result.current.retry();
    });
    expect(favorites.result.current.retrying).toBe(true);
    act(() => {
      favorites.result.current.retry();
    });
    expect(account.retryStuckWrites).toHaveBeenCalledTimes(1);

    await act(async () => {
      run.resolve(FAILED);
      await run.promise;
    });

    expect(library.result.current.retrying).toBe(false);
    expect(favorites.result.current.retrying).toBe(false);
  });

  it('starts one retry for two taps of one frame, before either hook rendered the first', async () => {
    const { account } = createStuckAccount(1);
    account.retryStuckWrites.mockResolvedValueOnce(FAILED);
    const library = renderSyncIssues({ account });
    const favorites = renderSyncIssues({ account });

    act(() => {
      library.result.current.retry();
      favorites.result.current.retry();
    });
    await settle();

    expect(account.retryStuckWrites).toHaveBeenCalledTimes(1);
    expect(favorites.result.current.retrying).toBe(false);
  });

  it('never shares the state of another instance', () => {
    const first = createStuckAccount(1).account;
    const second = createStuckAccount(1).account;
    first.retryStuckWrites.mockReturnValueOnce(new Promise<LibraryReplayRun>(() => undefined));
    second.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const firstHook = renderSyncIssues({ account: first });
    const secondHook = renderSyncIssues({ account: second });

    act(() => {
      firstHook.result.current.retry();
    });

    expect(firstHook.result.current.retrying).toBe(true);
    expect(secondHook.result.current.retrying).toBe(false);

    // a retry running on the other instance never blocks this one's actions
    act(() => {
      secondHook.result.current.discard();
    });

    expect(secondHook.result.current.feedback).toBe('discard-failed');
    expect(firstHook.result.current.feedback).toBeNull();
    expect(firstHook.result.current.retrying).toBe(true);
    expect(second.discardStuckWrites).toHaveBeenCalledTimes(1);
  });
});

describe('useLibrarySyncIssues feedback', () => {
  it('has none until an action could not happen', () => {
    const { account } = createStuckAccount(1);
    const { result } = renderSyncIssues({ account });

    expect(result.current.feedback).toBeNull();
  });

  it('says offline after a retry run that ended offline, in every hook, until the next retry starts', async () => {
    const { account } = createStuckAccount(1);
    account.retryStuckWrites.mockResolvedValueOnce(OFFLINE);
    const library = renderSyncIssues({ account });
    const favorites = renderSyncIssues({ account });

    act(() => {
      library.result.current.retry();
    });
    await settle();

    expect(library.result.current.feedback).toBe('offline');
    expect(favorites.result.current.feedback).toBe('offline');

    account.retryStuckWrites.mockReturnValueOnce(new Promise<LibraryReplayRun>(() => undefined));
    act(() => {
      favorites.result.current.retry();
    });

    expect(library.result.current.feedback).toBeNull();
    expect(library.result.current.retrying).toBe(true);
  });

  it('gives no feedback after a retry run that failed or rejected', async () => {
    const { account } = createStuckAccount(1);
    account.retryStuckWrites.mockResolvedValueOnce(FAILED);
    account.retryStuckWrites.mockRejectedValueOnce(new Error('store bug'));
    const { result } = renderSyncIssues({ account });

    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.feedback).toBeNull();

    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.feedback).toBeNull();
  });

  it('says the discard failed when its storage threw, until the next discard starts', () => {
    const { account } = createStuckAccount(2);
    account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const library = renderSyncIssues({ account });
    const favorites = renderSyncIssues({ account });

    act(() => {
      expect(library.result.current.discard()).toBe(0);
    });

    expect(library.result.current.feedback).toBe('discard-failed');
    expect(favorites.result.current.feedback).toBe('discard-failed');

    act(() => {
      favorites.result.current.discard();
    });

    expect(library.result.current.feedback).toBeNull();
  });

  it('gives each feedback set a new id, the same feedback again included, shared by the hooks', async () => {
    const { account } = createStuckAccount(2);
    account.discardStuckWrites
      .mockImplementationOnce(failingDiscard)
      .mockImplementationOnce(failingDiscard);
    account.retryStuckWrites.mockResolvedValue(OFFLINE);
    const library = renderSyncIssues({ account });
    const favorites = renderSyncIssues({ account });
    expect(library.result.current.feedbackId).toBe(0);

    act(() => {
      library.result.current.discard();
    });
    const first = library.result.current.feedbackId;
    act(() => {
      favorites.result.current.discard();
    });

    // a second failed discard in a row: the same feedback, a new id
    expect(library.result.current.feedback).toBe('discard-failed');
    expect(library.result.current.feedbackId).toBe(first + 1);
    expect(favorites.result.current.feedbackId).toBe(first + 1);

    act(() => {
      library.result.current.retry();
    });
    // cleared, the id kept until the next feedback
    expect(library.result.current.feedback).toBeNull();
    expect(library.result.current.feedbackId).toBe(first + 1);
    await settle();
    expect(favorites.result.current.feedback).toBe('offline');
    expect(favorites.result.current.feedbackId).toBe(first + 2);
  });

  it('clears an offline feedback when a discard starts, and a failed discard when a retry starts', async () => {
    const { account } = createStuckAccount(1);
    account.retryStuckWrites.mockResolvedValueOnce(OFFLINE);
    account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const { result } = renderSyncIssues({ account });

    act(() => {
      result.current.retry();
    });
    await settle();
    expect(result.current.feedback).toBe('offline');

    act(() => {
      result.current.discard();
    });
    expect(result.current.feedback).toBe('discard-failed');

    act(() => {
      result.current.retry();
    });
    expect(result.current.feedback).toBeNull();
    await settle();
  });

  it('goes with the last stuck write: a later stuck write shows no feedback', () => {
    const stuck = createStuckAccount(1);
    stuck.account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const { result } = renderSyncIssues({ account: stuck.account });
    act(() => {
      result.current.discard();
    });
    expect(result.current.feedback).toBe('discard-failed');

    act(() => {
      stuck.setStuckCount(0);
    });
    expect(result.current.feedback).toBeNull();

    act(() => {
      stuck.setStuckCount(1);
    });
    expect(result.current.feedback).toBeNull();
  });

  it('has none while the live library is not the account library', () => {
    const { result } = renderSyncIssues({ account: null });

    act(() => {
      result.current.retry();
    });

    expect(result.current.feedback).toBeNull();
  });
});
