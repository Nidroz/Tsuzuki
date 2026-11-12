import { describe, expect, it, jest } from '@jest/globals';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY } from '../../../test/core/library-entry-fixtures';
import { PROGRESS_WRITE_COALESCE_MS, setProgress } from '../domain/library-progress';
import { LibraryActionError } from '../errors/library-report-errors';
import { queryKeys } from '../query/keys';
import {
  ENTRY,
  flushMicrotasks,
  increment,
  OTHER_ENTRY,
  OTHER_KEY,
  SCOPE,
  scoreOf,
  setupWriter,
  statusOf,
} from '../../../test/core/library-writer-support';

const STORAGE_FAILURE = new Error('storage is full');
// above the known total of ENTRY (28): an invalid progress (BR-01)
const PROGRESS_ABOVE_TOTAL = 40;

describe('createLibraryWriter: reads', () => {
  it('reads the stored entry, null for a media not in the library', async () => {
    const { writer, activeKeyCount } = setupWriter();

    await expect(writer.read(ENTRY_KEY)).resolves.toBe(ENTRY);
    await expect(writer.read(OTHER_KEY)).resolves.toBeNull();
    expect(activeKeyCount()).toBe(0);
  });

  it('writes a pending `+1` before reading, so a read never returns an older state', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter();
    await load();

    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await flushMicrotasks();
    const read = await writer.read(ENTRY_KEY);
    await tap;

    expect(read?.progress).toBe(13);
    expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
      repository.get.mock.invocationCallOrder.at(-1) ?? 0,
    );
    expect(activeKeyCount()).toBe(0);
  });
});

describe('createLibraryWriter: failures', () => {
  it('rejects a failed write, refetches the entry, and the next write still runs', async () => {
    const { queryClient, repository, writer, load, activeKeyCount } = setupWriter();
    await load();
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toBe(STORAGE_FAILURE);

    expect(
      queryClient.getQueryState(queryKeys.library.entry(SCOPE, ENTRY_KEY))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(queryKeys.library.all(SCOPE))).toBeUndefined();
    await expect(writer.read(ENTRY_KEY)).resolves.toMatchObject({ score: 9 });

    await writer.apply(ENTRY_KEY, scoreOf(5));

    expect(repository.stored(ENTRY_KEY)?.score).toBe(5);
    expect(activeKeyCount()).toBe(0);
  });

  it('invalidates the cached list too, exactly, after a failed write', async () => {
    const { queryClient, repository, writer, load } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);
    queryClient.setQueryData(queryKeys.library.all(SCOPE), [ENTRY, OTHER_ENTRY]);
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toBe(STORAGE_FAILURE);

    const stateOf = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey);
    expect(stateOf(queryKeys.library.all(SCOPE))?.isInvalidated).toBe(true);
    expect(stateOf(queryKeys.library.entry(SCOPE, ENTRY_KEY))?.isInvalidated).toBe(true);
    expect(stateOf(queryKeys.library.entry(SCOPE, OTHER_KEY))?.isInvalidated).toBe(false);
  });

  it('rejects every tap of a failed coalesced write', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter();
    await load();
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    const taps = [
      writer.apply(ENTRY_KEY, increment, { coalesce: true }),
      writer.apply(ENTRY_KEY, increment, { coalesce: true }),
    ];
    const outcomes = Promise.allSettled(taps);
    await writer.flushAll();

    expect(await outcomes).toStrictEqual([
      { status: 'rejected', reason: STORAGE_FAILURE },
      { status: 'rejected', reason: STORAGE_FAILURE },
    ]);
    expect(repository.stored(ENTRY_KEY)?.progress).toBe(12);
    expect(activeKeyCount()).toBe(0);
  });

  it('drops a newer pending change of a key whose write failed: it fails with it, never written', async () => {
    const { queryClient, repository, writer, load, cached, activeKeyCount } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const failed = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    // a `+1` computed from the optimistic score 7, waiting in its window
    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    const outcomes = Promise.allSettled([failed, tap]);
    await flushMicrotasks();

    expect(cached()).toMatchObject({ score: 7, progress: ENTRY.progress + 1 });

    held.reject(STORAGE_FAILURE);

    expect(await outcomes).toStrictEqual([
      { status: 'rejected', reason: STORAGE_FAILURE },
      { status: 'rejected', reason: STORAGE_FAILURE },
    ]);
    await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toStrictEqual(ENTRY);
    expect(
      queryClient.getQueryState(queryKeys.library.entry(SCOPE, ENTRY_KEY))?.isInvalidated,
    ).toBe(true);
    await expect(writer.read(ENTRY_KEY)).resolves.toStrictEqual(ENTRY);
    expect(activeKeyCount()).toBe(0);
  });

  it('never sends a write chained behind a failed one, started before it failed: it fails with it', async () => {
    const { queryClient, repository, writer, load, activeKeyCount } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const failed = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    // computed from the optimistic score 7, its write chained behind the held one
    const chained = writer.apply(ENTRY_KEY, statusOf('paused'));
    const outcomes = Promise.allSettled([failed, chained]);
    await flushMicrotasks();

    held.reject(STORAGE_FAILURE);

    expect(await outcomes).toStrictEqual([
      { status: 'rejected', reason: STORAGE_FAILURE },
      { status: 'rejected', reason: STORAGE_FAILURE },
    ]);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toStrictEqual(ENTRY);
    expect(
      queryClient.getQueryState(queryKeys.library.entry(SCOPE, ENTRY_KEY))?.isInvalidated,
    ).toBe(true);
    await expect(writer.read(ENTRY_KEY)).resolves.toStrictEqual(ENTRY);
    expect(activeKeyCount()).toBe(0);
  });

  it('sends a write started once a failed write of its key settled, the key still busy', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter();
    await load();
    const heldSave = createDeferred();
    const heldRead = createDeferred();
    repository.beforeCall
      .mockReturnValueOnce(heldSave.promise)
      .mockReturnValueOnce(heldRead.promise);
    const failed = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    const read = writer.read(ENTRY_KEY);
    heldSave.reject(STORAGE_FAILURE);
    await expect(failed).rejects.toBe(STORAGE_FAILURE);

    // started after the failure, chained behind the read still held
    const later = writer.apply(ENTRY_KEY, scoreOf(5));
    await flushMicrotasks();
    heldRead.resolve();

    await expect(read).resolves.toStrictEqual(ENTRY);
    await later;
    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(5);
    expect(activeKeyCount()).toBe(0);
  });

  it('rejects a change on an entry not loaded yet with a fixed error, writing nothing', async () => {
    const { repository, writer, cached, activeKeyCount } = setupWriter();

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toStrictEqual(
      new LibraryActionError('entry-not-loaded'),
    );

    expect(repository.save).not.toHaveBeenCalled();
    expect(cached()).toBeUndefined();
    expect(activeKeyCount()).toBe(0);
  });

  it('rejects a change whose rule throws, leaving the entry as it was', async () => {
    const { repository, writer, load, cached, activeKeyCount } = setupWriter();
    await load();

    await expect(
      writer.apply(ENTRY_KEY, (entry, ctx) =>
        entry === null ? null : setProgress(entry, PROGRESS_ABOVE_TOTAL, ctx),
      ),
    ).rejects.toBeInstanceOf(RangeError);

    expect(repository.save).not.toHaveBeenCalled();
    expect(cached()).toBe(ENTRY);
    expect(activeKeyCount()).toBe(0);
  });
});
