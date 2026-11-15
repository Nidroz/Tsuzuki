import { describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react';

import { holdNextCall } from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import { LibraryRemoteError } from '../errors/library-errors';
import { LibraryFailureError } from '../errors/library-report-errors';
import {
  ACCOUNT_ENTRIES,
  ALLOWED_COVER,
  CLEAN,
  fullMergeOf,
  MANGA,
  renderRoom,
  settle,
} from '../../../test/core/guest-merge-room-support';
import type { GuestMergeValue } from './guest-merge-context';
import { GUEST_MERGE_ROOM_REPORT_SOURCE } from './use-guest-merge-room';

// per R-09 and ADR-0016 "Merge at the entry cap": the account library read while the guest merge
// is refused at the cap, the only way out on the device

const REPORT = [new LibraryFailureError('guest-merge'), { source: GUEST_MERGE_ROOM_REPORT_SOURCE }];

const otherMerges: readonly { readonly name: string; readonly merge: GuestMergeValue }[] = [
  { name: 'idle', merge: { status: 'idle', retry: jest.fn() } },
  { name: 'checking', merge: { status: 'checking', retry: jest.fn() } },
  { name: 'merging', merge: { status: 'merging', retry: jest.fn() } },
  { name: 'failed otherwise', merge: { status: 'failed', failure: 'other', retry: jest.fn() } },
  { name: 'failed without a reason', merge: { status: 'failed', retry: jest.fn() } },
];

describe('useGuestMergeRoom: when it is active', () => {
  it.each(otherMerges)(
    'reads nothing and does nothing while the merge is $name',
    async ({ merge }) => {
      const rendered = renderRoom({ merge });
      await settle();

      act(() => {
        rendered.result.current.remove(CLEAN.key);
        rendered.result.current.retry();
        rendered.result.current.reload();
      });
      await settle();

      expect(rendered.result.current).toMatchObject({
        active: false,
        status: 'loading',
        entries: [],
      });
      expect(rendered.account?.list).not.toHaveBeenCalled();
      expect(rendered.account?.remove).not.toHaveBeenCalled();
      expect(merge.retry).not.toHaveBeenCalled();
    },
  );

  it('reads nothing without an account instance, the merge refused at the cap', async () => {
    const merge = fullMergeOf();
    const rendered = renderRoom({ merge, account: null });
    await settle();

    act(() => {
      rendered.result.current.retry();
    });

    expect(rendered.result.current.active).toBe(false);
    expect(merge.retry).not.toHaveBeenCalled();
  });

  it('stops once the merge restarts, and reads again once it is refused again', async () => {
    const rendered = renderRoom();
    await settle();
    expect(rendered.result.current.status).toBe('ready');

    rendered.setMerge({ status: 'checking', retry: jest.fn() });
    expect(rendered.result.current).toMatchObject({
      active: false,
      status: 'loading',
      entries: [],
    });

    rendered.setMerge(fullMergeOf());
    expect(rendered.result.current).toMatchObject({ active: true, status: 'loading' });
    await settle();

    expect(rendered.result.current.status).toBe('ready');
    expect(rendered.account?.list).toHaveBeenCalledTimes(2);
  });

  it('reads the account of the session only: another user reads afresh', async () => {
    const rendered = renderRoom();
    await settle();
    const other = createStuckAccount(0, [MANGA]).account;

    rendered.setAccount(other);
    expect(rendered.result.current.status).toBe('loading');
    await settle();

    expect(rendered.result.current.entries).toStrictEqual([
      { ...MANGA, media: { ...MANGA.media, imageUrl: null } },
    ]);
    expect(other.list).toHaveBeenCalledTimes(1);
  });
});

describe('useGuestMergeRoom: the account library read', () => {
  it('lists the account entries in their order, the adult ones hidden and counted (BR-06)', async () => {
    const rendered = renderRoom();
    expect(rendered.result.current).toMatchObject({ active: true, status: 'loading', entries: [] });

    await settle();

    expect(rendered.result.current.status).toBe('ready');
    expect(rendered.result.current.entries.map((entry) => entry.key)).toStrictEqual([
      CLEAN.key,
      MANGA.key,
    ]);
    expect(rendered.result.current.hiddenCount).toBe(1);
    expect(rendered.account?.list).toHaveBeenCalledTimes(1);
  });

  it('shows the adult entries with the setting on', async () => {
    const rendered = renderRoom({ showAdult: true });
    await settle();

    expect(rendered.result.current.entries.map((entry) => entry.key)).toStrictEqual(
      ACCOUNT_ENTRIES.map((entry) => entry.key),
    );
    expect(rendered.result.current.hiddenCount).toBe(0);
  });

  it("keeps a cover on the catalog provider's hosts only (CONTRIBUTING.md §7)", async () => {
    const rendered = renderRoom();
    await settle();

    const [clean, manga] = rendered.result.current.entries;
    expect(clean?.media.imageUrl).toBe(ALLOWED_COVER);
    expect(manga?.media.imageUrl).toBeNull();
    // display copies: the stored entry keeps its cover
    expect(rendered.account?.stored(MANGA.key)?.media.imageUrl).toBe(MANGA.media.imageUrl);
  });

  it('shows a failed read as an error, unreported for an account store failure, and reads again on reload', async () => {
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    account.beforeCall.mockRejectedValueOnce(new LibraryRemoteError('network'));
    const rendered = renderRoom({ account });
    await settle();

    expect(rendered.result.current).toMatchObject({ status: 'error', entries: [] });
    expect(rendered.captureError).not.toHaveBeenCalled();

    act(() => {
      rendered.result.current.reload();
    });
    expect(rendered.result.current.status).toBe('loading');
    await settle();

    expect(rendered.result.current.status).toBe('ready');
    expect(rendered.account?.list).toHaveBeenCalledTimes(2);
  });

  it('reports an unexpected read failure as a fixed error only', async () => {
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    const failure = new Error('storage failed near "rewatch the finale"');
    account.beforeCall.mockRejectedValueOnce(failure);
    const rendered = renderRoom({ account });
    await settle();

    expect(rendered.result.current.status).toBe('error');
    expect(rendered.captureError.mock.calls).toStrictEqual([REPORT]);
    expect(rendered.captureError.mock.calls.flat()).not.toContain(failure);
  });

  it('never shows a read of an earlier refusal', async () => {
    const account = createStuckAccount(0, ACCOUNT_ENTRIES).account;
    const first = holdNextCall(account, 'list');
    const rendered = renderRoom({ account });
    await settle();

    rendered.setMerge(fullMergeOf());
    await settle();
    expect(rendered.result.current.status).toBe('ready');
    await act(async () => {
      first.reject(new LibraryRemoteError('network'));
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(rendered.result.current.status).toBe('ready');
    expect(rendered.result.current.entries).toHaveLength(2);
  });
});
