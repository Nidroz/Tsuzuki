import { describe, expect, it } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act } from '@testing-library/react';

import { createSessionAccount } from '../../../test/core/library-hooks-support';
import {
  PROBE_QUERY_KEY,
  renderSessionEndHook,
  STORED_SEARCH,
  type SessionEndSetup,
} from '../../../test/core/session-end-hooks-support';
import { AccountDeletionError } from '../errors/account-deletion-errors';
import { AuthError } from '../errors/auth-errors';
import { useDeleteAccount } from './use-delete-account';

const deletes = { deleteAccount: () => Promise.resolve(), signOut: () => Promise.resolve() };

const renderDelete = (setup: SessionEndSetup = {}) =>
  renderSessionEndHook(useDeleteAccount, { auth: deletes, ...setup });

type Rendered = ReturnType<typeof renderDelete>;

const deleteAccount = (rendered: Rendered) => act(() => rendered.result.current.hook.mutateAsync());

const expectRejection = async (rendered: Rendered, reason: string): Promise<void> => {
  await act(async () => {
    await expect(rendered.result.current.hook.mutateAsync()).rejects.toMatchObject({ reason });
  });
};

const expectNothingPurged = (rendered: Rendered): void => {
  expect(rendered.sequence()).not.toContain('purgeAccount');
  expect(rendered.guest.clear).not.toHaveBeenCalled();
  expect(rendered.recentSearches.stored()).toStrictEqual([STORED_SEARCH]);
  expect(rendered.queryClient.getQueryData(PROBE_QUERY_KEY)).toBe(1);
  expect(rendered.removePersistedCache).not.toHaveBeenCalled();
  expect(rendered.result.current.generation).toBe(0);
};

describe('useDeleteAccount', () => {
  it('deletes the account, purges the device, the queue included, then signs out', async () => {
    const account = createSessionAccount();
    account.queuedWriteCount.mockReturnValue(3);
    const rendered = renderDelete({ account });

    await deleteAccount(rendered);

    expect(rendered.sequence()).toStrictEqual([
      'deleteAccount',
      'purgeAccount',
      'clearGuest',
      'clearRecentSearches',
      'removePersistedCache',
      'signOut',
    ]);
    expect(account.queuedWriteCount).not.toHaveBeenCalled();
    expect(rendered.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(rendered.result.current.generation).toBe(1);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });

  it('rejects session-expired without an account instance, sending nothing', async () => {
    const rendered = renderDelete({ account: null });

    await expectRejection(rendered, 'session-expired');

    expect(rendered.sequence()).toStrictEqual([]);
    expectNothingPurged(rendered);
  });

  it('rejects offline while the device is offline, sending nothing', async () => {
    const rendered = renderDelete();
    onlineManager.setOnline(false);
    try {
      await act(async () => {
        await expect(rendered.result.current.hook.mutateAsync()).rejects.toStrictEqual(
          new AccountDeletionError('offline'),
        );
      });
    } finally {
      onlineManager.setOnline(true);
    }

    expect(rendered.sequence()).toStrictEqual([]);
    expectNothingPurged(rendered);
  });

  it('rejects with the deletion failure, purging nothing and staying signed in', async () => {
    const rendered = renderDelete({
      auth: { deleteAccount: () => Promise.reject(new AccountDeletionError('network')) },
    });

    await expectRejection(rendered, 'network');

    expect(rendered.sequence()).toStrictEqual(['deleteAccount']);
    expectNothingPurged(rendered);
  });

  it('keeps the guest library while the merge has not concluded', async () => {
    const rendered = renderDelete({ mergeStatus: 'failed' });

    await deleteAccount(rendered);

    expect(rendered.guest.clear).not.toHaveBeenCalled();
    expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an AuthError', new AuthError('network'), 'network'],
    ['another error', new Error('unexpected'), 'unknown'],
  ])(
    'reports a local sign out rejecting with %s after the deletion, and resolves',
    async (_case, failure, reason) => {
      const rendered = renderDelete({
        auth: { deleteAccount: () => Promise.resolve(), signOut: () => Promise.reject(failure) },
      });

      await deleteAccount(rendered);

      expect(rendered.captureError).toHaveBeenCalledTimes(1);
      expect(rendered.captureError).toHaveBeenCalledWith(failure, {
        source: 'account-deletion',
        tags: { step: 'sign-out', reason },
      });
      expect(rendered.account?.purgeDeviceData).toHaveBeenCalledTimes(1);
      expect(rendered.result.current.generation).toBe(1);
    },
  );
});
