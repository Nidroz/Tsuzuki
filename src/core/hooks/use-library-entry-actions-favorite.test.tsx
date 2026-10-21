import { describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react';

import { ENTRY_KEY, entryOf, entryWithMedia } from '../../../test/core/library-entry-fixtures';
import {
  FRESH_MEDIA,
  FRESH_TOTAL,
  MEDIA,
  renderLibraryEntry,
} from '../../../test/core/library-hooks-support';

// fR-15, BR-05: the favorite toggle of useLibraryEntryActions

const ENTRY = entryOf();
const STORAGE_FAILURE = new Error('storage is full');

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

describe('useLibraryEntryActions: toggleFavorite (FR-15)', () => {
  it('adds a media outside the library as a planned favorite with its snapshot (BR-05)', async () => {
    const { result, repository } = await renderLoaded([], MEDIA);

    await settleAction(result.current.actions.toggleFavorite);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      key: ENTRY_KEY,
      media: ENTRY.media,
      status: 'planned',
      progress: 0,
      isFavorite: true,
    });
    expect(result.current.entry.data).toStrictEqual(repository.stored(ENTRY_KEY));
    expect(result.current.actions.error).toBeNull();
  });

  it('toggles an entry on and off, its status and progress untouched', async () => {
    const { result, repository } = await renderLoaded([ENTRY], null);

    await settleAction(result.current.actions.toggleFavorite);

    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      isFavorite: true,
      status: ENTRY.status,
      progress: ENTRY.progress,
      media: ENTRY.media,
    });
    expect(repository.stored(ENTRY_KEY)?.updatedAt).not.toBe(ENTRY.updatedAt);

    await settleAction(result.current.actions.toggleFavorite);

    // unfavoriting keeps the entry
    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      isFavorite: false,
      status: ENTRY.status,
      progress: ENTRY.progress,
    });
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('toggles twice on two quick taps: each reads the entry as shown', async () => {
    const { result, repository } = await renderLoaded([ENTRY], null);

    await settleAction(() => {
      result.current.actions.toggleFavorite();
      result.current.actions.toggleFavorite();
    });
    await act(() => jest.advanceTimersByTimeAsync(0));

    expect(result.current.entry.data?.isFavorite).toBe(false);
    expect(repository.stored(ENTRY_KEY)?.isFavorite).toBe(false);
  });

  it('writes the catalog snapshot with the toggle, in the same write', async () => {
    const stale = entryWithMedia({ totalUnits: 12 });
    const { result, repository } = await renderLoaded([stale], FRESH_MEDIA);

    await settleAction(result.current.actions.toggleFavorite);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      isFavorite: true,
      progress: stale.progress,
      media: { totalUnits: FRESH_TOTAL },
    });
  });

  it('writes nothing for a media outside the library without catalog data', async () => {
    const { result, repository } = await renderLoaded([], null);

    await settleAction(result.current.actions.toggleFavorite);

    expect(repository.save).not.toHaveBeenCalled();
    expect(result.current.entry.data).toBeNull();
    expect(result.current.actions.error).toBeNull();
  });

  it('keeps the error of a failed save, and shows the stored entry again', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await settleAction(result.current.actions.toggleFavorite);

    expect(result.current.actions.error).toBe(STORAGE_FAILURE);
    await waitFor(() => {
      expect(result.current.entry.data?.isFavorite).toBe(false);
    });
    expect(repository.stored(ENTRY_KEY)).toBe(ENTRY);
  });
});
