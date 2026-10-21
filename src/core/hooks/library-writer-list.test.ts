import { describe, expect, it, jest } from '@jest/globals';

import { createDeferred } from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  ENTRY,
  flushMicrotasks,
  increment,
  OTHER_ENTRY,
  OTHER_KEY,
  removeEntry,
  scoreOf,
  setupWriter,
} from '../../../test/core/library-writer-support';
import { createLibraryEntry, type LibraryEntry } from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import { queryKeys } from '../query/keys';
import type { LibraryChange } from './library-writer';

const NEW_KEY = keyOf('anime', 3);
const SERVER_TIME = '2026-03-01T08:00:01.000Z';

// the add button rule on NEW_KEY
const addNew: LibraryChange = (entry, ctx) =>
  entry ?? createLibraryEntry(NEW_KEY, ENTRY.media, ctx);

describe('createLibraryWriter: list', () => {
  it('lists the stored entries and seeds the entry query of each, so actions need no load', async () => {
    const { repository, writer, cached } = setupWriter([ENTRY, OTHER_ENTRY]);

    await expect(writer.list()).resolves.toStrictEqual([ENTRY, OTHER_ENTRY]);

    expect(cached()).toBe(ENTRY);
    expect(cached(OTHER_KEY)).toBe(OTHER_ENTRY);

    await writer.apply(OTHER_KEY, scoreOf(3));

    expect(repository.stored(OTHER_KEY)?.score).toBe(3);
  });

  it('seeds a key whose read is in flight: nothing of it is unconfirmed', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY, OTHER_ENTRY]);
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const reading = load();
    await flushMicrotasks();

    await writer.list();

    expect(cached()).toBe(ENTRY);

    held.resolve();
    await reading;
  });

  it('shows a `+1` coalesced while listing, read when the list resolves, without seeding it', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const listing = writer.list();
    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await flushMicrotasks();
    held.resolve();
    const listed = await listing;

    expect(listed.map((entry) => entry.progress)).toStrictEqual([13, OTHER_ENTRY.progress]);
    expect(cached()?.progress).toBe(13);
    expect(repository.save).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
    await tap;

    expect(repository.stored(ENTRY_KEY)?.progress).toBe(13);
  });

  it('leaves out an entry being removed and shows one being added first', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    await load(NEW_KEY);
    const removing = createDeferred();
    const adding = createDeferred();
    repository.beforeCall.mockReturnValueOnce(removing.promise).mockReturnValueOnce(adding.promise);
    const writes = [writer.apply(ENTRY_KEY, removeEntry), writer.apply(NEW_KEY, addNew)];
    await flushMicrotasks();

    const listed = await writer.list();

    expect(listed.map((entry) => entry.key)).toStrictEqual([NEW_KEY, OTHER_KEY]);
    expect(cached()).toBeNull();

    removing.resolve();
    adding.resolve();
    await Promise.all(writes);
  });

  it('keeps the listed entry of a key being written whose entry query is gone', async () => {
    const { queryClient, repository, writer, load } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const applying = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    queryClient.removeQueries({ queryKey: queryKeys.library.entry(ENTRY_KEY), exact: true });

    await expect(writer.list()).resolves.toStrictEqual([ENTRY]);

    held.resolve();
    await applying;
  });

  it('seeds nothing when a write settled while listing', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const listing = writer.list();
    await writer.apply(ENTRY_KEY, scoreOf(7));
    held.resolve();
    await listing;

    expect(cached(OTHER_KEY)).toBeUndefined();
  });

  it('overlays a key being written and seeds an idle one, in the same list', async () => {
    const { repository, writer, load, cached } = setupWriter([ENTRY, OTHER_ENTRY]);
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const applying = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();
    const optimistic = cached();

    await expect(writer.list()).resolves.toStrictEqual([optimistic, OTHER_ENTRY]);

    // the stored entry never replaces the optimistic one; the idle key needs no load
    expect(cached()).toBe(optimistic);
    expect(cached(OTHER_KEY)).toBe(OTHER_ENTRY);

    held.resolve();
    await applying;
  });

  it('never waits for the writes of a key', async () => {
    const { repository, writer, load } = setupWriter();
    await load();
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const applying = writer.apply(ENTRY_KEY, scoreOf(7));
    await flushMicrotasks();

    const listed = await writer.list();

    expect(listed.map((entry) => entry.score)).toStrictEqual([7]);
    expect(repository.stored(ENTRY_KEY)?.score).toBe(ENTRY.score);

    held.resolve();
    await applying;
  });
});

describe('createLibraryWriter: cached list data', () => {
  // the entries seeded by a list, as the list query does
  const setupWithList = async () => {
    const setup = setupWriter([ENTRY, OTHER_ENTRY]);
    await setup.writer.list();
    const listed = () =>
      setup.queryClient.getQueryData<readonly LibraryEntry[]>(queryKeys.library.all());
    return { ...setup, listed };
  };

  it('shows a change in the list at once, then the stored entry', async () => {
    const { queryClient, repository, writer, listed } = await setupWithList();
    queryClient.setQueryData(queryKeys.library.all(), [ENTRY, OTHER_ENTRY]);
    const held = createDeferred();
    // a server sets its own timestamps (the supabase repository, A-03)
    repository.save.mockImplementationOnce(async (entry) => {
      await held.promise;
      return { ...entry, updatedAt: SERVER_TIME };
    });

    const applying = writer.apply(OTHER_KEY, scoreOf(3));
    await flushMicrotasks();

    expect(listed()?.map((entry) => entry.score)).toStrictEqual([ENTRY.score, 3]);

    held.resolve();
    await applying;

    expect(listed()?.[1]).toMatchObject({ score: 3, updatedAt: SERVER_TIME });
  });

  it('drops a removed entry from the list and adds a new one first', async () => {
    const { queryClient, writer, load, listed } = await setupWithList();
    queryClient.setQueryData(queryKeys.library.all(), [ENTRY, OTHER_ENTRY]);
    await load(NEW_KEY);

    await writer.apply(OTHER_KEY, removeEntry);
    await writer.apply(NEW_KEY, addNew);

    expect(listed()?.map((entry) => entry.key)).toStrictEqual([NEW_KEY, ENTRY_KEY]);
  });

  it('drops an entry removed from the detail at once, a list refetch meanwhile included', async () => {
    const { queryClient, repository, writer, listed } = await setupWithList();
    queryClient.setQueryData(queryKeys.library.all(), [ENTRY, OTHER_ENTRY]);
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    const removing = writer.apply(OTHER_KEY, removeEntry);
    await flushMicrotasks();

    expect(listed()).toStrictEqual([ENTRY]);
    expect(repository.stored(OTHER_KEY)).toBe(OTHER_ENTRY);
    await expect(writer.list()).resolves.toStrictEqual([ENTRY]);

    held.resolve();
    await removing;

    expect(listed()).toStrictEqual([ENTRY]);
    expect(repository.stored(OTHER_KEY)).toBeNull();
  });

  it('leaves the list alone while it has no data', async () => {
    const { queryClient, writer, load } = setupWriter();
    await load();

    await writer.apply(ENTRY_KEY, scoreOf(7));

    expect(queryClient.getQueryData(queryKeys.library.all())).toBeUndefined();
  });
});

describe('createLibraryWriter: idle keys', () => {
  it('serves a key again once its earlier writes settled, newer changes never replaced', async () => {
    const { repository, writer, load, cached } = setupWriter();
    await load();
    await writer.apply(ENTRY_KEY, scoreOf(7));
    const tap = writer.apply(ENTRY_KEY, increment, { coalesce: true });
    await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
    await tap;

    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);
    const first = writer.apply(ENTRY_KEY, scoreOf(5));
    await flushMicrotasks();
    const second = writer.apply(ENTRY_KEY, scoreOf(4));
    await flushMicrotasks();
    const optimistic = cached();
    held.resolve();
    await first;

    expect(cached()).toBe(optimistic);

    await second;

    expect(repository.stored(ENTRY_KEY)).toMatchObject({ score: 4, progress: 13 });
    expect(cached()).toStrictEqual(repository.stored(ENTRY_KEY));
  });
});
