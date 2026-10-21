import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import {
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf } from '../../../test/core/library-entry-fixtures';
import { createQueryClient } from '../query/query-client';
import { libraryWrapper, MEDIA } from '../../../test/core/library-hooks-support';
import { MISSING_LIBRARY_PROVIDER_MESSAGE } from './library-context';
import { LibraryContextProvider } from './LibraryContextProvider';
import { useLibraryContext } from './use-library-context';
import { useLibraryEntry } from './use-library-entry';
import { useLibraryEntryActions } from './use-library-entry-actions';

const ENTRY = entryOf();

// the `+1` button of the media of ENTRY_KEY, once its entry is loaded
const seen: { increment: (() => void) | null } = { increment: null };

function IncrementProbe() {
  const entry = useLibraryEntry(ENTRY_KEY, { media: MEDIA });
  const { incrementProgress } = useLibraryEntryActions(ENTRY_KEY, { media: MEDIA });
  const loaded = entry.isSuccess;
  useEffect(() => {
    seen.increment = loaded ? incrementProgress : null;
  }, [loaded, incrementProgress]);
  return null;
}

const treeOf = (
  queryClient: ReturnType<typeof createQueryClient>,
  repository: FakeLibraryRepository,
): ReactNode => (
  <QueryClientProvider client={queryClient}>
    <LibraryContextProvider repository={repository}>
      <IncrementProbe />
    </LibraryContextProvider>
  </QueryClientProvider>
);

// renders the probe over `first` and taps `+1` once, inside the coalescing window
const renderWithPendingTap = async (first: FakeLibraryRepository) => {
  const queryClient = createQueryClient();
  seen.increment = null;
  const rendered = render(treeOf(queryClient, first));
  await waitFor(() => {
    expect(seen.increment).not.toBeNull();
  });
  act(() => {
    seen.increment?.();
  });
  return { ...rendered, queryClient };
};

describe('LibraryContextProvider', () => {
  it('gives the hooks the given repository and a writer over it', () => {
    const queryClient = createQueryClient();
    const repository = createFakeLibraryRepository();

    const { result, rerender } = renderHook(useLibraryContext, {
      wrapper: libraryWrapper(queryClient, repository),
    });
    const before = result.current;
    rerender();

    expect(result.current.repository).toBe(repository);
    expect(result.current).toBe(before);
  });

  it('writes a pending `+1` to its repository when the repository changes', async () => {
    const first = createFakeLibraryRepository([ENTRY]);
    const second = createFakeLibraryRepository([ENTRY]);
    const { rerender, queryClient } = await renderWithPendingTap(first);

    await act(async () => {
      rerender(treeOf(queryClient, second));
      // no time passes: the write comes from the swap, not the coalescing window
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(first.save).toHaveBeenCalledTimes(1);
    expect(first.stored(ENTRY_KEY)?.progress).toBe(13);
    expect(second.save).not.toHaveBeenCalled();
  });

  it('writes a pending `+1` when it unmounts', async () => {
    const repository = createFakeLibraryRepository([ENTRY]);
    const { unmount } = await renderWithPendingTap(repository);

    await act(async () => {
      unmount();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(repository.stored(ENTRY_KEY)?.progress).toBe(13);
  });

  it('makes useLibraryContext throw outside of it', () => {
    expect(() => renderHook(useLibraryContext)).toThrow(MISSING_LIBRARY_PROVIDER_MESSAGE);
  });
});
