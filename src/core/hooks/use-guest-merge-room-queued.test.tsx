import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { holdNextCall, type Deferred } from '../../../test/core/fake-library-repository';
import {
  ACCOUNT_ENTRIES,
  CLEAN,
  driveQueuedWrites,
  fullMergeOf,
  renderReadyRoom,
  settle,
} from '../../../test/core/guest-merge-room-support';
import { createStuckAccount } from '../../../test/core/stuck-account';
import { LibraryRemoteError } from '../errors/library-errors';

// per R-09 and R-10: a removal the server did not confirm, kept queued by the offline account
// library, is told per call by its queue listeners, never by the queued write count (the queue
// holds one write per key: removing a key already queued leaves the count as it was)

// the queued write count before the removal and once it was kept queued
const keptQueued = [
  { queue: 'an empty queue', before: 0, after: 1 },
  { queue: 'its key already queued (stuck, or queued offline)', before: 1, after: 1 },
];

describe('useGuestMergeRoom: a removal kept queued', () => {
  it.each(keptQueued)(
    'says offline and retries nothing, with $queue, until a removal is confirmed',
    async ({ before, after }) => {
      const merge = fullMergeOf();
      const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
      const queue = driveQueuedWrites(account);
      let queuedCount = before;
      account.queuedWriteCount.mockImplementation(() => queuedCount);
      queue.keepNextRemovalQueued(() => {
        queuedCount = after;
      });
      const rendered = await renderReadyRoom({ merge, account });

      act(() => {
        rendered.result.current.remove(CLEAN.key);
      });
      await settle();

      expect(rendered.result.current).toMatchObject({ failure: 'offline', busy: false });
      expect(merge.retry).not.toHaveBeenCalled();
      expect(rendered.captureError).not.toHaveBeenCalled();

      // the same key sent again, confirmed this time (no queue listener called): the merge
      // retried, whatever the queued count answers
      act(() => {
        rendered.result.current.remove(CLEAN.key);
      });
      expect(rendered.result.current.failure).toBeNull();
      await settle();

      expect(account.remove.mock.calls).toStrictEqual([[CLEAN.key], [CLEAN.key]]);
      expect(merge.retry).toHaveBeenCalledTimes(1);
      expect(rendered.result.current).toMatchObject({ busy: true, failure: null });
    },
  );
});

// how the removal settles, and what the room shows then
const settlings = [
  {
    name: 'confirmed',
    settleHeld: (held: Deferred<void>) => {
      held.resolve();
    },
    retries: 1,
    failure: null,
  },
  {
    name: 'refused',
    settleHeld: (held: Deferred<void>) => {
      held.reject(new LibraryRemoteError('rejected'));
    },
    retries: 0,
    failure: 'failed',
  },
];

describe('useGuestMergeRoom: the queue listener of a removal', () => {
  it.each(settlings)(
    'listens while the removal runs only, unsubscribed once it is $name',
    async ({ settleHeld, retries, failure }) => {
      const merge = fullMergeOf();
      const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
      const queue = driveQueuedWrites(account);
      const rendered = await renderReadyRoom({ merge, account });
      const held = holdNextCall(account, 'remove');

      act(() => {
        rendered.result.current.remove(CLEAN.key);
      });
      expect(queue.listenerCount()).toBe(1);
      await act(async () => {
        settleHeld(held);
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(queue.listenerCount()).toBe(0);
      expect(merge.retry).toHaveBeenCalledTimes(retries);
      expect(rendered.result.current.failure).toBe(failure);
      // one subscription, for this removal only
      expect(account.subscribeToQueuedWrites).toHaveBeenCalledTimes(1);
    },
  );
});
