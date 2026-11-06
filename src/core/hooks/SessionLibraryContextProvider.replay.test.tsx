import { afterEach, describe, expect, it } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act } from '@testing-library/react';

import { createDeferred, holdNextCall } from '../../../test/core/fake-library-repository';
import { entryOf } from '../../../test/core/library-entry-fixtures';
import {
  createForegroundSource,
  renderSessionLibrary,
  settleSession,
  USER_A,
  USER_B,
  type FakeSessionAccount,
} from '../../../test/core/session-library-support';
import type { LibraryReplayRun } from '../repositories/offline-account-library-repository';
import { LIBRARY_REPLAY_REPORT_SOURCE } from '../errors/library-errors';

// per ADR-0017 "Hooks": the replay driver of the account library whose guest merge is done. the
// account fakes resolve every run with nothing replayed unless a test sets them up

const ACCOUNT_ENTRIES = new Map([[USER_A, [entryOf()]]]);
const GUEST_ENTRY = entryOf({ progress: 1 });
const CONFIRMED_RUN: LibraryReplayRun = { status: 'done', confirmed: 1 };

afterEach(() => {
  // the onlineManager is one module instance for the whole file
  onlineManager.setOnline(true);
});

const setOnline = async (online: boolean): Promise<void> => {
  await act(async () => {
    onlineManager.setOnline(online);
    await Promise.resolve();
  });
  await settleSession();
};

// signed in as USER_A, the merge done (an empty guest store), the first run settled
const renderLive = async (foreground = createForegroundSource()) => {
  const rendered = await renderSessionLibrary({
    session: { userId: USER_A },
    accountEntries: ACCOUNT_ENTRIES,
    subscribeToForeground: foreground.subscribe,
  });
  await settleSession();
  const account = rendered.accountOf(0);
  return { ...rendered, account, foreground };
};

const signalOf = (account: FakeSessionAccount, call: number): AbortSignal | undefined =>
  account.replayQueuedWrites.mock.calls[call]?.[0]?.signal;

describe('SessionLibraryContextProvider replay driver (A-05)', () => {
  it('runs once when the account becomes live, the foreground and the live triggers together', async () => {
    const { account, result } = await renderLive();

    expect(result.current.repository).toBe(account);
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
    expect(signalOf(account, 0)?.aborted).toBe(false);
  });

  it('runs on reconnect, on a return to the foreground and on a queued write, once per step', async () => {
    const { account, foreground } = await renderLive();

    await setOnline(false);
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
    await setOnline(true);
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(2);

    act(() => {
      foreground.change(false);
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(2);
    act(() => {
      foreground.change(true);
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(3);

    act(() => {
      account.notifyQueued();
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(4);

    // several triggers of one step: one run
    onlineManager.setOnline(false);
    act(() => {
      onlineManager.setOnline(true);
      foreground.change(true);
      account.notifyQueued();
      account.notifyQueued();
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(5);
  });

  it('never runs before the merge is done, nor while it failed', async () => {
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY],
      onAccount: (_userId, account) => {
        account.mergeGuestEntries.mockRejectedValueOnce(new Error('merge refused'));
      },
    });
    await rendered.emit({ userId: USER_A });
    await settleSession();
    const account = rendered.accountOf(0);

    expect(rendered.result.current.merge.status).toBe('failed');
    act(() => {
      account.notifyQueued();
    });
    await settleSession();

    expect(account.replayQueuedWrites).not.toHaveBeenCalled();
  });

  it('runs once the merge it waited for is done', async () => {
    const merges: ReturnType<typeof holdNextCall>[] = [];
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY],
      onAccount: (_userId, account) => {
        merges.push(holdNextCall(account, 'mergeGuestEntries'));
      },
    });
    await rendered.emit({ userId: USER_A });
    const account = rendered.accountOf(0);

    expect(rendered.result.current.merge.status).toBe('merging');
    expect(account.replayQueuedWrites).not.toHaveBeenCalled();

    await act(async () => {
      merges[0]?.resolve();
      await Promise.resolve();
    });
    await settleSession();

    expect(rendered.result.current.repository).toBe(account);
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
  });

  it('invalidates the live library after a run that confirmed writes, only then', async () => {
    const { account } = await renderLive();
    const reads = account.get.mock.calls.length;

    act(() => {
      account.notifyQueued();
    });
    await settleSession();
    expect(account.get).toHaveBeenCalledTimes(reads);

    account.replayQueuedWrites.mockResolvedValueOnce(CONFIRMED_RUN);
    act(() => {
      account.notifyQueued();
    });
    await settleSession();

    // the entry of the live scope refetched the server state
    expect(account.get).toHaveBeenCalledTimes(reads + 1);
  });

  it('aborts the run of an account signed out, and never runs it again', async () => {
    const { account, emit } = await renderLive();
    const held = createDeferred<LibraryReplayRun>();
    account.replayQueuedWrites.mockReturnValueOnce(held.promise);
    act(() => {
      account.notifyQueued();
    });
    await settleSession();
    const signal = signalOf(account, 1);

    await emit(null);

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      held.resolve(CONFIRMED_RUN);
      account.notifyQueued();
      await Promise.resolve();
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(2);
  });

  it('starts no run for a trigger of the step that unmounts it', async () => {
    const { account, unmount } = await renderLive();

    act(() => {
      account.notifyQueued();
      unmount();
    });
    await settleSession();

    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
  });

  it("replays the next user's account only, the previous one's run aborted", async () => {
    const { account, emit, accountOf } = await renderLive();

    await emit({ userId: USER_B });
    await settleSession();

    expect(signalOf(account, 0)?.aborted).toBe(true);
    const accountB = accountOf(1);
    expect(accountB.replayQueuedWrites).toHaveBeenCalledTimes(1);
    act(() => {
      account.notifyQueued();
    });
    await settleSession();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
  });

  it('reports a run that rejected, never throwing it into react', async () => {
    const { account, captureError } = await renderLive();
    const failure = new Error('replay broke');
    account.replayQueuedWrites.mockRejectedValueOnce(failure);

    act(() => {
      account.notifyQueued();
    });
    await settleSession();

    expect(captureError).toHaveBeenCalledWith(failure, { source: LIBRARY_REPLAY_REPORT_SOURCE });
  });
});
