import { describe, expect, it } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

import { ENTRY_KEY, entryOf } from '../../../test/core/library-entry-fixtures';
import {
  FRESH_MEDIA,
  FRESH_TOTAL,
  MEDIA,
  renderLibraryEntry,
  UNSTORABLE_MEDIA,
} from '../../../test/core/library-hooks-support';
import { MISSING_LIBRARY_PROVIDER_MESSAGE } from './library-context';
import { useLibraryEntry } from './use-library-entry';

const ENTRY = entryOf();

describe('useLibraryEntry', () => {
  it('is pending while the entry loads, then shows the stored entry', async () => {
    const { result, repository } = renderLibraryEntry([ENTRY], null);

    // the repository answers asynchronously: the first render has no entry yet
    expect(result.current.entry.isPending).toBe(true);

    await waitFor(() => {
      expect(result.current.entry.data).toBe(ENTRY);
    });
    expect(repository.get).toHaveBeenCalledWith(ENTRY_KEY);
  });

  it('is null for a media not in the library', async () => {
    const { result } = renderLibraryEntry([], MEDIA);

    await waitFor(() => {
      expect(result.current.entry.isSuccess).toBe(true);
    });
    expect(result.current.entry.data).toBeNull();
  });

  it('shows the stored entry itself when the catalog snapshot is the same', async () => {
    const { result } = renderLibraryEntry([ENTRY], MEDIA);

    await waitFor(() => {
      expect(result.current.entry.data).toBe(ENTRY);
    });
  });

  it('shows the catalog snapshot without writing it, and keeps the selection stable', async () => {
    const { result, rerender, repository } = renderLibraryEntry([ENTRY], FRESH_MEDIA);

    await waitFor(() => {
      expect(result.current.entry.data?.media.totalUnits).toBe(FRESH_TOTAL);
    });
    const shown = result.current.entry.data;
    rerender({ media: FRESH_MEDIA });

    expect(result.current.entry.data).toBe(shown);
    expect(shown?.updatedAt).toBe(ENTRY.updatedAt);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.stored(ENTRY_KEY)?.media.totalUnits).toBe(ENTRY.media.totalUnits);
  });

  it('fails the query, not the render, for catalog data no snapshot can hold', async () => {
    const { result } = renderLibraryEntry([ENTRY], UNSTORABLE_MEDIA);

    await waitFor(() => {
      expect(result.current.entry.error).toBeInstanceOf(RangeError);
    });
  });

  it('throws outside LibraryContextProvider', () => {
    expect(() => renderHook(() => useLibraryEntry(ENTRY_KEY, { media: null }))).toThrow(
      MISSING_LIBRARY_PROVIDER_MESSAGE,
    );
  });
});
