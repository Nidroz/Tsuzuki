import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { createDeferred } from '../../../test/core/fake-library-repository';
import {
  PROBE_QUERY_KEY,
  renderSessionEndHook,
  STORED_SEARCH,
  type SessionEndSetup,
} from '../../../test/core/session-end-hooks-support';
import { createSessionAccount, NOTHING_REPLAYED } from '../../../test/core/session-library-support';
import { AuthError } from '../errors/auth-errors';
import { SignOutSyncError } from '../errors/sign-out-errors';
import type { LibraryReplayRun } from '../repositories/library-repository';
import { SIGN_OUT_SYNC_TIMEOUT_MS, useSignOut, type SignOutResult } from './use-sign-out';

const signOutResolves = { signOut: () => Promise.resolve() };

const renderSignOut = (setup: SessionEndSetup = {}) =>
  renderSessionEndHook(useSignOut, { auth: signOutResolves, ...setup });

type Rendered = ReturnType<typeof renderSignOut>;

const signOut = async (rendered: Rendered, discardUnsynced?: boolean): Promise<SignOutResult> => {
  let outcome: SignOutResult | undefined;
  await act(async () => {
    outcome = await rendered.result.current.hook.mutateAsync(
      discardUnsynced === undefined ? {} : { discardUnsynced },
    );
  });
  if (outcome === undefined) {
    throw new Error('the sign out did not resolve');
  }
  return outcome;
};

const PURGE = ['purgeAccount', 'clearGuest', 'clearRecentSearches', 'removePersistedCache'];

const expectNothingPurged = (rendered: Rendered): void => {
  expect(rendered.sequence()).not.toContain('purgeAccount');
  expect(rendered.guest.clear).not.toHaveBeenCalled();
  expect(rendered.recentSearches.stored()).toStrictEqual([STORED_SEARCH]);
  expect(rendered.queryClient.getQueryData(PROBE_QUERY_KEY)).toBe(1);
  expect(rendered.removePersistedCache).not.toHaveBeenCalled();
  expect(rendered.result.current.generation).toBe(0);
};

describe('useSignOut', () => {
  it('flushes, replays, flushes, counts and signs out, then purges the device, the mutation kept', async () => {
    const rendered = renderSignOut();

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.sequence()).toStrictEqual([
      'flush',
      'replay',
      'flush',
      'count',
      'signOut',
      ...PURGE,
    ]);
    expect(rendered.account?.replayQueuedWrites).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(rendered.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(rendered.queryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(rendered.result.current.generation).toBe(1);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it('signs out only without an account instance', async () => {
    const rendered = renderSignOut({ account: null });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.sequence()).toStrictEqual(['signOut']);
    expectNothingPurged(rendered);
  });

  it('resolves unsynced with the count and does nothing else while writes stay queued', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(2);
    const rendered = renderSignOut({ account });

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'unsynced', count: 2 });

    expect(rendered.sequence()).toStrictEqual(['flush', 'replay', 'flush', 'count']);
    expectNothingPurged(rendered);
  });

  it('counts the changes the live writer still holds after its second flush as unsynced', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(1);
    const rendered = renderSignOut({ account });
    rendered.writer.pendingChangeCount.mockReturnValue(1);

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'unsynced', count: 2 });

    expect(rendered.sequence()).toStrictEqual(['flush', 'replay', 'flush', 'count']);
    expectNothingPurged(rendered);
  });

  it('syncs again, skips the count and purges the queue once the user confirmed', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(2);
    const rendered = renderSignOut({ account });

    await expect(signOut(rendered, true)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.sequence()).toStrictEqual(['flush', 'replay', 'flush', 'signOut', ...PURGE]);
    expect(account.queuedWriteCount).not.toHaveBeenCalled();
    expect(rendered.writer.pendingChangeCount).not.toHaveBeenCalled();
  });

  it('stops waiting for a stuck replay at the budget, its signal aborted', async () => {
    const account = createSessionAccount();
    account.replayQueuedWrites.mockImplementation(() => createDeferred<LibraryReplayRun>().promise);
    const rendered = renderSignOut({ account });
    let outcome: Promise<SignOutResult> | undefined;

    await act(async () => {
      outcome = rendered.result.current.hook.mutateAsync({});
      await jest.advanceTimersByTimeAsync(SIGN_OUT_SYNC_TIMEOUT_MS - 1);
    });

    const signal = account.replayQueuedWrites.mock.calls[0]?.[0]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(rendered.auth.signOut).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });

    await expect(outcome).resolves.toStrictEqual({ status: 'signed-out' });
    expect(signal?.aborted).toBe(true);
    expect(rendered.sequence()).toStrictEqual(['flush', 'replay', 'count', 'signOut', ...PURGE]);
  });

  it('starts no replay once a stuck flush used the budget', async () => {
    const rendered = renderSignOut();
    const flush = createDeferred();
    rendered.writer.flushAll.mockReturnValue(flush.promise);
    let outcome: Promise<SignOutResult> | undefined;

    await act(async () => {
      outcome = rendered.result.current.hook.mutateAsync({});
      await jest.advanceTimersByTimeAsync(SIGN_OUT_SYNC_TIMEOUT_MS);
    });
    await act(async () => {
      flush.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    await expect(outcome).resolves.toStrictEqual({ status: 'signed-out' });
    expect(rendered.account?.replayQueuedWrites).not.toHaveBeenCalled();
  });

  it.each<['flush' | 'replay', 'writer' | 'account']>([
    ['flush', 'writer'],
    ['replay', 'account'],
  ])('reports a failed %s without its error and still signs out', async (step, target) => {
    // stored content quoted by a storage error
    const failure = new Error('storage unavailable: Title A');
    const rendered = renderSignOut();
    if (target === 'writer') {
      rendered.writer.flushAll.mockRejectedValueOnce(failure);
    } else {
      rendered.account?.replayQueuedWrites.mockRejectedValueOnce(failure);
    }

    await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

    expect(rendered.captureError).toHaveBeenCalledTimes(1);
    const [reported, context] = rendered.captureError.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(SignOutSyncError);
    expect(reported).toMatchObject({ step, message: `Sign out sync failed: ${step}` });
    expect(reported).not.toHaveProperty('cause');
    expect(context).toStrictEqual({ source: 'sign-out', tags: { step } });
    expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
  });

  it('rejects with the AuthError of signOut and purges nothing', async () => {
    const rendered = renderSignOut({
      auth: { signOut: () => Promise.reject(new AuthError('network')) },
    });

    await act(async () => {
      await expect(rendered.result.current.hook.mutateAsync({})).rejects.toMatchObject({
        reason: 'network',
      });
    });

    expect(rendered.sequence()).toStrictEqual(['flush', 'replay', 'flush', 'count', 'signOut']);
    expectNothingPurged(rendered);
  });

  it.each(['checking', 'merging', 'failed'] as const)(
    'keeps the guest library and flushes no writer while the merge is %s',
    async (mergeStatus) => {
      const rendered = renderSignOut({ mergeStatus });

      await expect(signOut(rendered)).resolves.toStrictEqual({ status: 'signed-out' });

      expect(rendered.guest.clear).not.toHaveBeenCalled();
      expect(rendered.sequence()).toStrictEqual([
        'replay',
        'count',
        'signOut',
        'purgeAccount',
        'clearRecentSearches',
        'removePersistedCache',
      ]);
    },
  );

  it('reads the merge status as the session ends, not as the call started', async () => {
    const account = createSessionAccount();
    const replay = createDeferred<LibraryReplayRun>();
    account.replayQueuedWrites.mockReturnValue(replay.promise);
    const rendered = renderSignOut({ account, mergeStatus: 'merging' });
    let outcome: Promise<SignOutResult> | undefined;

    await act(async () => {
      outcome = rendered.result.current.hook.mutateAsync({});
      await jest.advanceTimersByTimeAsync(0);
    });
    rendered.setMergeStatus('idle');
    await act(async () => {
      replay.resolve(NOTHING_REPLAYED);
      await jest.advanceTimersByTimeAsync(0);
    });

    await expect(outcome).resolves.toStrictEqual({ status: 'signed-out' });
    expect(rendered.guest.clear).toHaveBeenCalledTimes(1);
    // the merge concluded during the replay: the account's writer is flushed after it
    expect(rendered.sequence().slice(0, 3)).toStrictEqual(['replay', 'flush', 'count']);
  });

  it('signs out without waiting for the budget while the merge failed and a read is pending', async () => {
    const rendered = renderSignOut({ mergeStatus: 'failed' });
    // the pending library's writer: a read that never settles holds its flush
    rendered.writer.flushAll.mockReturnValue(createDeferred().promise);
    let outcome: Promise<SignOutResult> | undefined;

    await act(async () => {
      outcome = rendered.result.current.hook.mutateAsync({});
      await jest.advanceTimersByTimeAsync(0);
    });

    await expect(outcome).resolves.toStrictEqual({ status: 'signed-out' });
    expect(rendered.writer.flushAll).not.toHaveBeenCalled();
    expect(rendered.writer.pendingChangeCount).not.toHaveBeenCalled();
    expect(rendered.sequence()).toContain('replay');
    expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
  });
});
