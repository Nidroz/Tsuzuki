import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  createDeferred,
  createFakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import {
  libraryWrapper,
  MEDIA,
  renderLibraryEntry,
} from '../../../test/core/library-hooks-support';
import type { MediaKey } from '../domain/media';
import { createQueryClient } from '../query/query-client';
import { MISSING_LIBRARY_PROVIDER_MESSAGE } from './library-context';
import { useLibraryEntry } from './use-library-entry';
import { useLibraryEntryActions } from './use-library-entry-actions';

const ENTRY = entryOf();
const OTHER_KEY = keyOf('manga', 2);
const OTHER_ENTRY = entryOf({ key: OTHER_KEY });
const STORAGE_FAILURE = new Error('storage is full');
// above the known total of ENTRY (28): an invalid progress (BR-01)
const PROGRESS_ABOVE_TOTAL = 40;

type Rendered = ReturnType<typeof renderLibraryEntry>;

// the entry loaded, as the screen enables the actions only then
const renderLoaded = async (...args: Parameters<typeof renderLibraryEntry>): Promise<Rendered> => {
  const rendered = renderLibraryEntry(...args);
  await waitFor(() => {
    expect(rendered.result.current.entry.isSuccess).toBe(true);
  });
  return rendered;
};

// runs an action and lets its write settle
const settleAction = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await jest.advanceTimersByTimeAsync(0);
  });
};

// a list row: the entry and actions of the key it shows, recycled for another key on rerender
const renderRow = async (key: MediaKey) => {
  const repository = createFakeLibraryRepository([ENTRY, OTHER_ENTRY]);
  const rendered = renderHook(
    ({ rowKey }: { readonly rowKey: MediaKey }) => ({
      entry: useLibraryEntry(rowKey, { media: null }),
      actions: useLibraryEntryActions(rowKey, { media: null }),
    }),
    { initialProps: { rowKey: key }, wrapper: libraryWrapper(createQueryClient(), repository) },
  );
  await waitFor(() => {
    expect(rendered.result.current.entry.isSuccess).toBe(true);
  });
  return { ...rendered, repository };
};

describe('useLibraryEntryActions: errors', () => {
  it('keeps the error of a failed write until the next action or a dismiss', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await settleAction(() => {
      result.current.actions.setScore(7);
    });

    expect(result.current.actions.error).toBe(STORAGE_FAILURE);
    await waitFor(() => {
      expect(result.current.entry.data?.score).toBe(ENTRY.score);
    });

    await settleAction(() => {
      result.current.actions.setScore(6);
    });

    expect(result.current.actions.error).toBeNull();

    await settleAction(() => {
      result.current.actions.setProgress(PROGRESS_ABOVE_TOTAL);
    });

    expect(result.current.actions.error).toBeInstanceOf(RangeError);

    act(() => {
      result.current.actions.dismissError();
    });

    expect(result.current.actions.error).toBeNull();
    expect(repository.stored(ENTRY_KEY)?.score).toBe(6);
  });

  it('keeps its callbacks for a new key object of the same media', async () => {
    const { result, rerender } = await renderLoaded([ENTRY], MEDIA);
    const before = result.current.actions;

    rerender({ media: MEDIA });

    expect(result.current.actions).toBe(before);
  });

  it('throws outside LibraryContextProvider', () => {
    expect(() => renderHook(() => useLibraryEntryActions(ENTRY_KEY, { media: null }))).toThrow(
      MISSING_LIBRARY_PROVIDER_MESSAGE,
    );
  });
});

describe('useLibraryEntryActions: errors of a recycled row', () => {
  it('shows no error of the previous key once the row shows another one', async () => {
    const { result, rerender, repository } = await renderRow(ENTRY_KEY);
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await settleAction(() => {
      result.current.actions.setScore(7);
    });

    expect(result.current.actions.error).toBe(STORAGE_FAILURE);

    rerender({ rowKey: OTHER_KEY });

    expect(result.current.actions.error).toBeNull();
  });

  it('never shows a failure of the previous key settling after the change', async () => {
    const { result, rerender, repository } = await renderRow(ENTRY_KEY);
    const held = createDeferred();
    repository.beforeCall.mockReturnValueOnce(held.promise);

    // the write starts, then waits for the held save
    await settleAction(() => {
      result.current.actions.setScore(7);
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    rerender({ rowKey: OTHER_KEY });
    await settleAction(() => {
      held.reject(STORAGE_FAILURE);
    });

    expect(result.current.actions.error).toBeNull();
    expect(repository.stored(ENTRY_KEY)?.score).toBe(ENTRY.score);
  });
});
