import { describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  createDeferred,
  createFakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf } from '../../../test/core/library-entry-fixtures';
import { MEDIA, switchableLibraryWrapper } from '../../../test/core/library-hooks-support';
import type { LibraryEntry } from '../domain/library-entry';
import { DEFAULT_LIBRARY_VIEW } from '../domain/library-view';
import { queryKeys, type LibraryScope } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import type { LibraryRepository } from '../repositories/library-repository';
import { MISSING_LIBRARY_PROVIDER_MESSAGE } from './library-context';
import type { RetiredLibrary } from './LibraryContextProvider';
import { useLibraryContext } from './use-library-context';
import { useLibraryEntry } from './use-library-entry';
import { useLibraryEntryActions } from './use-library-entry-actions';
import { useLibraryList } from './use-library-list';

// the stored entry of ENTRY_KEY in the first library (progress 12) and in the next one
const ENTRY = entryOf();
const NEXT_ENTRY = entryOf({ progress: 3 });

// what a library screen reads: the context, the entry of ENTRY_KEY with its actions, the list
const useLibraryProbe = () => ({
  context: useLibraryContext(),
  entry: useLibraryEntry(ENTRY_KEY, { media: MEDIA }),
  actions: useLibraryEntryActions(ENTRY_KEY, { media: MEDIA }),
  list: useLibraryList(DEFAULT_LIBRARY_VIEW, { showAdult: true, layoutKey: 0 }),
});

// the probe over `first`, its entry and list loaded; `swap` switches the repository
const renderLoaded = async (
  first: LibraryRepository,
  onRetired?: (retired: RetiredLibrary) => void,
) => {
  const queryClient = createQueryClient();
  const { wrapper, switchTo, setOnRetired } = switchableLibraryWrapper(
    queryClient,
    first,
    onRetired,
  );
  const rendered = renderHook(useLibraryProbe, { wrapper });
  await waitFor(() => {
    expect(rendered.result.current.entry.isSuccess).toBe(true);
    expect(rendered.result.current.list.query.isSuccess).toBe(true);
  });
  const swap = (next: LibraryRepository) => {
    act(() => {
      switchTo(next);
      rendered.rerender();
    });
  };
  // another onRetired, the repository kept
  const changeOnRetired = (next: (retired: RetiredLibrary) => void) => {
    act(() => {
      setOnRetired(next);
      rendered.rerender();
    });
  };
  return { ...rendered, queryClient, swap, changeOnRetired };
};

type Rendered = Awaited<ReturnType<typeof renderLoaded>>;

// a `+1` tap: shown at once, its write waiting in the coalescing window
const tapIncrement = (rendered: Rendered) =>
  act(async () => {
    rendered.result.current.actions.incrementProgress();
    await jest.advanceTimersByTimeAsync(0);
  });

const queriesOf = (queryClient: QueryClient, scope: LibraryScope) =>
  queryClient.getQueryCache().findAll({ queryKey: queryKeys.library.all(scope) });

// the progress of every listed entry (the list shows display copies, covers checked)
const listedProgressOf = (rendered: Rendered): readonly number[] =>
  [...(rendered.result.current.list.query.data?.current.values() ?? [])].map(
    (entry: LibraryEntry) => entry.progress,
  );

describe('LibraryContextProvider', () => {
  it('gives the hooks the given repository, a writer over it and their scope, kept on render', async () => {
    const repository = createFakeLibraryRepository([ENTRY]);
    const rendered = await renderLoaded(repository);
    const before = rendered.result.current.context;

    rendered.rerender();

    expect(rendered.result.current.context).toBe(before);
    expect(before.repository).toBe(repository);
    expect(queriesOf(rendered.queryClient, before.scope)).toHaveLength(2);
  });

  it('gives a new repository a new writer and scope in the same render, read from scratch', async () => {
    const rendered = await renderLoaded(createFakeLibraryRepository([ENTRY]));
    const before = rendered.result.current.context;
    const next = createFakeLibraryRepository([NEXT_ENTRY]);

    rendered.swap(next);

    const after = rendered.result.current.context;
    expect(after.repository).toBe(next);
    expect(after.writer).not.toBe(before.writer);
    expect(after.scope).not.toBe(before.scope);
    // the first frame reads the new scope only: nothing of the previous library shows
    expect(rendered.result.current.entry.data).toBeUndefined();
    expect(rendered.result.current.list.view).toBeUndefined();
    await waitFor(() => {
      expect(rendered.result.current.entry.data).toStrictEqual(NEXT_ENTRY);
    });
    expect(listedProgressOf(rendered)).toStrictEqual([NEXT_ENTRY.progress]);
  });

  it('writes a pending `+1` to the repository it was made for, never under the new scope', async () => {
    const first = createFakeLibraryRepository([ENTRY]);
    const next = createFakeLibraryRepository([NEXT_ENTRY]);
    const rendered = await renderLoaded(first);
    const oldScope = rendered.result.current.context.scope;
    await tapIncrement(rendered);
    const save = createDeferred();
    first.beforeCall.mockReturnValueOnce(save.promise);

    rendered.swap(next);

    // removed at once, before the flush settled
    expect(queriesOf(rendered.queryClient, oldScope)).toHaveLength(0);
    await waitFor(() => {
      expect(rendered.result.current.entry.data).toStrictEqual(NEXT_ENTRY);
    });
    expect(first.save).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(first.stored(ENTRY_KEY)?.progress).toBe(ENTRY.progress + 1);
    expect(next.save).not.toHaveBeenCalled();
    expect(rendered.result.current.entry.data).toStrictEqual(NEXT_ENTRY);
    expect(listedProgressOf(rendered)).toStrictEqual([NEXT_ENTRY.progress]);
    // the stored entry the flushed write set again is removed once the flush settled
    expect(queriesOf(rendered.queryClient, oldScope)).toHaveLength(0);
  });

  it('writes a pending `+1` when it unmounts, and removes its queries', async () => {
    const repository = createFakeLibraryRepository([ENTRY]);
    const rendered = await renderLoaded(repository);
    const { scope } = rendered.result.current.context;
    await tapIncrement(rendered);

    await act(async () => {
      rendered.unmount();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(repository.stored(ENTRY_KEY)?.progress).toBe(ENTRY.progress + 1);
    expect(queriesOf(rendered.queryClient, scope)).toHaveLength(0);
  });

  it('reports a retired repository with the flush of its pending writes (ADR-0016)', async () => {
    const first = createFakeLibraryRepository([ENTRY]);
    const onRetired = jest.fn<(retired: RetiredLibrary) => void>();
    const rendered = await renderLoaded(first, onRetired);
    await tapIncrement(rendered);
    const save = createDeferred();
    first.beforeCall.mockReturnValueOnce(save.promise);

    rendered.swap(createFakeLibraryRepository([NEXT_ENTRY]));

    expect(onRetired).toHaveBeenCalledTimes(1);
    const retired = onRetired.mock.calls[0]?.[0];
    expect(retired?.repository).toBe(first);
    const settled = jest.fn();
    void retired?.flushed.then(settled);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    // the `+1` write is running: the flush waits for it
    expect(first.save).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(settled).toHaveBeenCalledTimes(1);
    expect(first.stored(ENTRY_KEY)?.progress).toBe(ENTRY.progress + 1);
  });

  it('settles the flush of a failed write without rejecting', async () => {
    const first = createFakeLibraryRepository([ENTRY]);
    const onRetired = jest.fn<(retired: RetiredLibrary) => void>();
    const rendered = await renderLoaded(first, onRetired);
    await tapIncrement(rendered);
    first.beforeCall.mockRejectedValueOnce(new Error('storage failure'));

    rendered.swap(createFakeLibraryRepository([NEXT_ENTRY]));
    const flushed = onRetired.mock.calls[0]?.[0].flushed;

    // the failed write rejects its `+1` action, which sets its error state: inside act
    await act(async () => {
      await expect(flushed).resolves.toBeUndefined();
    });
    expect(first.stored(ENTRY_KEY)).toStrictEqual(ENTRY);
  });

  it('reports the value it retires when it unmounts', async () => {
    const repository = createFakeLibraryRepository([ENTRY]);
    const onRetired = jest.fn<(retired: RetiredLibrary) => void>();
    const rendered = await renderLoaded(repository, onRetired);

    rendered.unmount();

    expect(onRetired).toHaveBeenCalledTimes(1);
    expect(onRetired.mock.calls[0]?.[0].repository).toBe(repository);
  });

  it('keeps the live value for a new onRetired, and reports to the latest one only', async () => {
    const repository = createFakeLibraryRepository([ENTRY]);
    const first = jest.fn<(retired: RetiredLibrary) => void>();
    const latest = jest.fn<(retired: RetiredLibrary) => void>();
    const rendered = await renderLoaded(repository, first);
    const before = rendered.result.current.context;

    rendered.changeOnRetired(latest);

    expect(rendered.result.current.context).toBe(before);
    expect(queriesOf(rendered.queryClient, before.scope)).toHaveLength(2);
    expect(rendered.result.current.entry.data).toStrictEqual(ENTRY);

    rendered.swap(createFakeLibraryRepository([NEXT_ENTRY]));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest.mock.calls[0]?.[0].repository).toBe(repository);
  });

  it('makes useLibraryContext throw outside of it', () => {
    expect(() => renderHook(useLibraryContext)).toThrow(MISSING_LIBRARY_PROVIDER_MESSAGE);
  });
});
