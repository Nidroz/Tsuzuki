import { describe, expect, it } from '@jest/globals';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY } from '../../../test/core/library-entry-fixtures';
import { setProgress } from '../domain/library-progress';
import { queryKeys } from '../query/keys';
import {
  ENTRY,
  flushMicrotasks,
  increment,
  OTHER_ENTRY,
  OTHER_KEY,
  scoreOf,
  setupWriter,
} from '../../../test/core/library-writer-support';

const STORAGE_FAILURE = new Error('storage is full');
// above the known total of ENTRY (28): an invalid progress (BR-01)
const PROGRESS_ABOVE_TOTAL = 40;

describe('createLibraryWriter: reads', () => {
  it('reads the stored entry, null for a media not in the library', async () => {
    const { writer } = setupWriter();

    await expect(writer.read(ENTRY_KEY)).resolves.toBe(ENTRY);
    await expect(writer.read(OTHER_KEY)).resolves.toBeNull();
  });

  it('writes a pending `+1` before reading, so a read never returns an older state', async () => {
    const { repository, writer, load } = setupWriter();
    await load();

    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await flushMicrotasks();
    const read = await writer.read(ENTRY_KEY);
    await tap;

    expect(read?.progress).toBe(13);
    expect(repository.save.mock.invocationCallOrder[0]).toBeLessThan(
      repository.get.mock.invocationCallOrder.at(-1) ?? 0,
    );
  });
});

describe('createLibraryWriter: failures', () => {
  it('rejects a failed write, refetches the entry, and the next write still runs', async () => {
    const { queryClient, repository, writer, load } = setupWriter();
    await load();
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toBe(STORAGE_FAILURE);

    expect(queryClient.getQueryState(queryKeys.library.entry(ENTRY_KEY))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.library.all())).toBeUndefined();
    await expect(writer.read(ENTRY_KEY)).resolves.toMatchObject({ score: 9 });

    await writer.apply(ENTRY_KEY, scoreOf(5));

    expect(repository.stored(ENTRY_KEY)?.score).toBe(5);
  });

  it('invalidates the cached list too, exactly, after a failed write', async () => {
    const { queryClient, repository, writer, load } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);
    queryClient.setQueryData(queryKeys.library.all(), [ENTRY, OTHER_ENTRY]);
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toBe(STORAGE_FAILURE);

    const stateOf = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey);
    expect(stateOf(queryKeys.library.all())?.isInvalidated).toBe(true);
    expect(stateOf(queryKeys.library.entry(ENTRY_KEY))?.isInvalidated).toBe(true);
    expect(stateOf(queryKeys.library.entry(OTHER_KEY))?.isInvalidated).toBe(false);
  });

  it('rejects every tap of a failed coalesced write', async () => {
    const { repository, writer, load } = setupWriter();
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
  });

  it('rejects a change on an entry not loaded yet, writing nothing', async () => {
    const { repository, writer, cached } = setupWriter();

    await expect(writer.apply(ENTRY_KEY, scoreOf(7))).rejects.toThrow(
      'library change applied before the library entry was loaded',
    );

    expect(repository.save).not.toHaveBeenCalled();
    expect(cached()).toBeUndefined();
  });

  it('rejects a change whose rule throws, leaving the entry as it was', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();

    await expect(
      writer.apply(ENTRY_KEY, (entry, ctx) =>
        entry === null ? null : setProgress(entry, PROGRESS_ABOVE_TOTAL, ctx),
      ),
    ).rejects.toBeInstanceOf(RangeError);

    expect(repository.save).not.toHaveBeenCalled();
    expect(cached()).toBe(ENTRY);
  });
});

describe('createLibraryWriter: flushAll', () => {
  it('writes every pending `+1` now, without waiting for the window', async () => {
    const { repository, writer, load } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);

    const taps = [
      writer.apply(ENTRY_KEY, increment, { coalesce: true }),
      writer.apply(OTHER_KEY, increment, { coalesce: true }),
    ];
    await flushMicrotasks();
    await writer.flushAll();
    await Promise.all(taps);

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(repository.stored(ENTRY_KEY)?.progress).toBe(13);
    expect(repository.stored(OTHER_KEY)?.progress).toBe(13);
  });

  it('writes a `+1` applied just before, still waiting for its cancel', async () => {
    const { repository, writer, load } = setupWriter();
    await load();

    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await writer.flushAll();

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)?.progress).toBe(13);
    await tap;
  });

  it('waits for the writes in flight, and resolves when one fails', async () => {
    const { repository, writer, load } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const failed = writer.apply(ENTRY_KEY, scoreOf(7)).catch((error: unknown) => error);
    await flushMicrotasks();

    let flushed = false;
    const flushing = writer.flushAll().then(() => {
      flushed = true;
    });
    await flushMicrotasks();

    expect(flushed).toBe(false);

    held.reject(STORAGE_FAILURE);
    await flushing;

    await expect(failed).resolves.toBe(STORAGE_FAILURE);
  });

  it('resolves at once with nothing pending', async () => {
    const { repository, writer } = setupWriter();

    await writer.flushAll();

    expect(repository.save).not.toHaveBeenCalled();
  });
});
