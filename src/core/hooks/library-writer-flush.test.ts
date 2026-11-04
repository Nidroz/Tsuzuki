import { describe, expect, it } from '@jest/globals';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY } from '../../../test/core/library-entry-fixtures';
import {
  ENTRY,
  flushMicrotasks,
  increment,
  OTHER_ENTRY,
  OTHER_KEY,
  scoreOf,
  setupWriter,
  statusOf,
} from '../../../test/core/library-writer-support';

const STORAGE_FAILURE = new Error('storage is full');

describe('createLibraryWriter: flushAll', () => {
  it('writes every pending `+1` now, without waiting for the window', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter([ENTRY, OTHER_ENTRY]);
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
    expect(activeKeyCount()).toBe(0);
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
    const { repository, writer, load, activeKeyCount } = setupWriter();
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
    expect(activeKeyCount()).toBe(0);
  });

  it('resolves once a write chained behind a failed one failed with it, nothing left pending', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const failed = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    const chained = writer.apply(ENTRY_KEY, statusOf('paused'));
    const outcomes = Promise.allSettled([failed, chained]);
    await flushMicrotasks();
    expect(writer.pendingChangeCount()).toBe(1);

    const flushing = writer.flushAll();
    held.reject(STORAGE_FAILURE);
    await flushing;

    expect(writer.pendingChangeCount()).toBe(0);
    expect((await outcomes).map(({ status }) => status)).toStrictEqual(['rejected', 'rejected']);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(activeKeyCount()).toBe(0);
  });

  it('resolves at once with nothing pending', async () => {
    const { repository, writer } = setupWriter();

    await writer.flushAll();

    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe('createLibraryWriter: pendingChangeCount (A-06)', () => {
  it('counts the keys with a change pending or being written, never a read', async () => {
    const { repository, writer, load, activeKeyCount } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);
    expect(writer.pendingChangeCount()).toBe(0);

    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await flushMicrotasks();
    expect(writer.pendingChangeCount()).toBe(1);

    const heldSave = createDeferred();
    const heldRead = createDeferred();
    repository.beforeCall
      .mockReturnValueOnce(heldSave.promise)
      .mockReturnValueOnce(heldRead.promise);
    const flushing = writer.flushAll();
    await flushMicrotasks();
    const read = writer.read(OTHER_KEY);
    await flushMicrotasks();
    expect(writer.pendingChangeCount()).toBe(1);
    expect(activeKeyCount()).toBe(2);

    heldSave.resolve();
    await flushing;
    await tap;
    expect(writer.pendingChangeCount()).toBe(0);
    expect(activeKeyCount()).toBe(1);

    heldRead.resolve();
    await read;
    expect(activeKeyCount()).toBe(0);
  });
});
