import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';

import { holdNextCall, type Deferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  createForegroundSource,
  renderSessionLibrary,
  settleSession,
  USER_A,
  USER_B,
  type RenderedSessionLibrary,
} from '../../../test/core/session-library-support';
import type { AuthSession } from '../repositories/auth-repository';
import { LibraryRemoteError } from '../errors/library-errors';

// adR-0017 "Hooks": the guest merge retried on reconnect and aborted once its session ended, and
// the live library writer flushed when the app goes to the background

const GUEST_ENTRY = entryOf({ progress: 1 });
const GUEST_OTHER = entryOf({ key: keyOf('manga', 2), progress: 4 });
const ENTRY = entryOf();

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

// a `+1` tap: shown at once, its write waiting in the coalescing window
const tapIncrement = async (rendered: RenderedSessionLibrary) => {
  await act(async () => {
    rendered.result.current.actions.incrementProgress();
    await jest.advanceTimersByTimeAsync(0);
  });
};

describe('SessionLibraryContextProvider guest merge offline (A-05)', () => {
  it('retries a failed merge when the device reconnects, and shows the account library', async () => {
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY],
      onAccount: (_userId, account) => {
        account.mergeGuestEntries.mockRejectedValueOnce(new LibraryRemoteError('network'));
      },
    });
    await rendered.emit({ userId: USER_A });
    await settleSession();
    const account = rendered.accountOf(0);
    expect(rendered.result.current.merge.status).toBe('failed');

    await setOnline(false);
    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);
    await setOnline(true);

    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(2);
    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
  });

  it('starts no merge on reconnect unless the last one failed', async () => {
    const rendered = await renderSessionLibrary({ session: { userId: USER_A } });
    await settleSession();

    await setOnline(false);
    await setOnline(true);

    expect(rendered.result.current.merge.status).toBe('idle');
    expect(rendered.guest.list).toHaveBeenCalledTimes(1);
  });

  it.each<[string, AuthSession | null]>([
    ['the user signed out', null],
    ['another user signed in', { userId: USER_B }],
  ])('aborts the signal of a merge once %s, and keeps it for the live one', async (_name, next) => {
    const merges: Deferred<void>[] = [];
    const rendered = await renderSessionLibrary({
      guestEntries: [GUEST_ENTRY, GUEST_OTHER],
      onAccount: (_userId, account) => {
        merges.push(holdNextCall(account, 'mergeGuestEntries'));
      },
    });
    await rendered.emit({ userId: USER_A });
    const signal = rendered.accountOf(0).mergeGuestEntries.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    // a token refresh keeps the account: its merge goes on
    await rendered.emit({ userId: USER_A });
    expect(signal?.aborted).toBe(false);

    await rendered.emit(next);

    expect(signal?.aborted).toBe(true);
    await act(async () => {
      merges[0]?.resolve();
      await Promise.resolve();
    });
    await settleSession();
    // the stale run removed nothing
    expect(rendered.guest.removeUnchanged).not.toHaveBeenCalled();
  });
});

describe('SessionLibraryContextProvider under StrictMode (A-05)', () => {
  it('never aborts the merge of the committed account, then replays it once live', async () => {
    const merges: Deferred<void>[] = [];
    const rendered = await renderSessionLibrary({
      session: { userId: USER_A },
      guestEntries: [GUEST_ENTRY],
      strictMode: true,
      onAccount: (_userId, account) => {
        merges.push(holdNextCall(account, 'mergeGuestEntries'));
      },
    });
    await settleSession();
    const account = rendered.accountOf(0);
    const signal = account.mergeGuestEntries.mock.calls[0]?.[1]?.signal;

    expect(account.mergeGuestEntries).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      merges[0]?.resolve();
      await Promise.resolve();
    });
    await settleSession();

    expect(rendered.result.current.repository).toBe(account);
    expect(rendered.guest.stored(ENTRY_KEY)).toBeNull();
    const runs = account.replayQueuedWrites.mock.calls;
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.at(-1)?.[0]?.signal?.aborted).toBe(false);
  });
});

describe('SessionLibraryContextProvider background flush (A-05)', () => {
  it.each<[string, AuthSession | null]>([
    ['the account library', { userId: USER_A }],
    ['the guest library', null],
  ])(
    'writes a coalesced `+1` of %s when the app goes to the background',
    async (_name, session) => {
      const foreground = createForegroundSource();
      const rendered = await renderSessionLibrary({
        session,
        guestEntries: session === null ? [ENTRY] : [],
        accountEntries: new Map([[USER_A, [ENTRY]]]),
        subscribeToForeground: foreground.subscribe,
      });
      await waitFor(() => {
        expect(rendered.result.current.entry.data).toStrictEqual(ENTRY);
      });
      const repository = session === null ? rendered.guest : rendered.accountOf(0);
      await tapIncrement(rendered);
      expect(repository.save).not.toHaveBeenCalled();

      act(() => {
        foreground.change(false);
      });
      await settleSession();

      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(repository.stored(ENTRY_KEY)?.progress).toBe(ENTRY.progress + 1);
    },
  );

  it('subscribes to the foreground once for every library, and stops on unmount', async () => {
    const foreground = createForegroundSource();
    const rendered = await renderSessionLibrary({ subscribeToForeground: foreground.subscribe });
    const subscribed = foreground.listenerCount();

    await rendered.emit({ userId: USER_A });
    await settleSession();
    // the driver of the live account library listens too
    expect(foreground.listenerCount()).toBe(subscribed + 1);

    rendered.unmount();

    expect(foreground.listenerCount()).toBe(0);
  });
});
