import { describe, expect, it, jest } from '@jest/globals';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY } from '../../../test/core/library-entry-fixtures';
import { createLibraryEntry } from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import { queryKeys } from '../query/keys';
import {
  ENTRY,
  flushMicrotasks,
  increment,
  OTHER_ENTRY,
  OTHER_KEY,
  removeEntry,
  scoreOf,
  setupWriter,
  statusOf,
} from '../../../test/core/library-writer-support';

const JUST_BEFORE_WINDOW_MS = PROGRESS_WRITE_COALESCE_MS - 1;
const PART_OF_WINDOW_MS = 400;
const WRITE_TIME = new Date('2026-03-01T08:00:00.000Z');
const SERVER_TIME = '2026-03-01T08:00:01.000Z';

describe('createLibraryWriter: optimistic writes', () => {
  it('shows the change at once, before the write resolves, then writes it', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const applying = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();

    expect(cached()?.score).toBe(7);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(9);

    held.resolve();
    await applying;

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(7);
  });

  it('replaces the optimistic entry with the stored one the repository returns', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();
    // a server sets its own timestamps (the supabase repository, A-03)
    repository.save.mockImplementationOnce((entry) =>
      Promise.resolve({ ...entry, updatedAt: SERVER_TIME }),
    );

    await writer.apply(ENTRY_KEY, scoreOf(7));

    expect(cached()).toMatchObject({ score: 7, updatedAt: SERVER_TIME });
  });

  it('dates the change with its clock (BR-09)', async () => {
    const { repository, writer, load } = setupWriter([ENTRY], () => WRITE_TIME);
    await load();

    await writer.apply(ENTRY_KEY, scoreOf(7));

    expect(repository.stored(ENTRY_KEY)?.updatedAt).toBe(WRITE_TIME.toISOString());
  });

  it('writes nothing for a no-op change (BR-09)', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY]);
    await load();
    await load(OTHER_KEY);

    await writer.apply(ENTRY_KEY, scoreOf(ENTRY.score));
    await writer.apply(OTHER_KEY, removeEntry);

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(cached()).toBe(ENTRY);
    expect(cached(OTHER_KEY)).toBeNull();
  });

  it('adds an entry missing from the library, and removes it with null', async () => {
    const { repository, writer, load, cached } = setupWriter([]);
    await load(OTHER_KEY);

    await writer.apply(
      OTHER_KEY,
      (entry, ctx) => entry ?? createLibraryEntry(OTHER_KEY, OTHER_ENTRY.media, ctx),
    );

    expect(repository.stored(OTHER_KEY)).toMatchObject({ status: 'planned', progress: 0 });

    await writer.apply(OTHER_KEY, removeEntry);

    expect(repository.remove).toHaveBeenCalledWith(OTHER_KEY);
    expect(repository.stored(OTHER_KEY)).toBeNull();
    expect(cached(OTHER_KEY)).toBeNull();
  });
});

describe('createLibraryWriter: coalesced `+1` taps (BR-09)', () => {
  it('writes taps of one window once, with the last entry, each tap restarting the window', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();

    const taps = [writer.apply(ENTRY_KEY, increment, { coalesce: true })];
    await jest.advanceTimersByTimeAsync(PART_OF_WINDOW_MS);
    taps.push(writer.apply(ENTRY_KEY, increment, { coalesce: true }));
    await jest.advanceTimersByTimeAsync(PART_OF_WINDOW_MS);
    taps.push(writer.apply(ENTRY_KEY, increment, { coalesce: true }));
    await jest.advanceTimersByTimeAsync(JUST_BEFORE_WINDOW_MS);

    expect(cached()?.progress).toBe(15);
    expect(repository.save).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(taps);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ progress: 15 }));
    expect(repository.stored(ENTRY_KEY)?.progress).toBe(15);
  });

  it('writes a change made during the window at once, with the taps, in one save', async () => {
    const { repository, writer, load } = setupWriter();
    await load();

    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    const status = writer.apply(ENTRY_KEY, statusOf('paused'));
    await Promise.all([tap, status]);
    await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toMatchObject({ progress: 13, status: 'paused' });
  });
});

describe('createLibraryWriter: per-key order', () => {
  it('starts a write of a key once the previous one settled, other keys not waiting', async () => {
    const { repository, writer, load } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const first = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    const second = writer.apply(ENTRY_KEY, statusOf('paused'));
    const other = writer.apply(OTHER_KEY, scoreOf(3));
    await other;

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(repository.stored(OTHER_KEY)?.score).toBe(3);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(9);

    held.resolve();
    await Promise.all([first, second]);

    expect(repository.save).toHaveBeenCalledTimes(3);
    expect(repository.stored(ENTRY_KEY)).toMatchObject({ score: 7, status: 'paused' });
  });

  it('keeps a newer optimistic entry when an older write settles, then shows the stored one', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();
    const firstHeld = createDeferred();
    const secondHeld = createDeferred();
    repository.beforeCall
      .mockReturnValueOnce(firstHeld.promise)
      .mockReturnValueOnce(secondHeld.promise);

    const first = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    const second = writer.apply(ENTRY_KEY, scoreOf(5));
    await flushMicrotasks();
    const optimistic = cached();
    firstHeld.resolve();
    await first;

    expect(cached()).toBe(optimistic);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(7);

    secondHeld.resolve();
    await second;

    expect(cached()).toStrictEqual(repository.stored(ENTRY_KEY));
    expect(cached()?.score).toBe(5);
  });

  it('cancels a refetch in flight, whose older result never replaces the change', async () => {
    const { queryClient, repository, writer, load, cached } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const refetch = queryClient.query({
      queryKey: queryKeys.library.entry(ENTRY_KEY),
      queryFn: () => writer.read(ENTRY_KEY),
      staleTime: 0,
    });

    const applying = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();

    expect(cached()?.score).toBe(7);

    held.resolve();
    await Promise.all([refetch, applying]);

    expect(repository.get).toHaveBeenCalledTimes(2);
    expect(cached()).toStrictEqual(repository.stored(ENTRY_KEY));
  });

  it('invalidates the list query alone, exactly, after a write', async () => {
    const { queryClient, writer, load } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(OTHER_KEY);
    queryClient.setQueryData(queryKeys.library.all(), [ENTRY, OTHER_ENTRY]);

    await writer.apply(ENTRY_KEY, scoreOf(7));

    const stateOf = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey);
    expect(stateOf(queryKeys.library.all())?.isInvalidated).toBe(true);
    expect(stateOf(queryKeys.library.entry(ENTRY_KEY))?.isInvalidated).toBe(false);
    expect(stateOf(queryKeys.library.entry(OTHER_KEY))?.isInvalidated).toBe(false);
  });
});
