import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { RECENT_SEARCHES_MAX } from '../domain/recent-searches';
import type { RecentSearchesRepository } from '../repositories/recent-searches-repository';
import { MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE } from './recent-searches-context';
import { RecentSearchesContextProvider } from './RecentSearchesContextProvider';
import { useRecentSearches } from './use-recent-searches';

const SAVE_FAILURE = 'storage is full';

// a repository over an in-memory list, with jest mocks to see the calls
const createMemoryRepository = (initial: readonly string[] = []) => {
  let stored = initial;
  const repository = {
    load: jest.fn(() => stored),
    save: jest.fn((searches: readonly string[]) => {
      stored = searches;
    }),
    clear: jest.fn(() => {
      stored = [];
    }),
  } satisfies RecentSearchesRepository;
  return { repository, stored: () => stored };
};

const renderRecentSearches = (repository: RecentSearchesRepository) =>
  renderHook(useRecentSearches, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <RecentSearchesContextProvider repository={repository}>
        {children}
      </RecentSearchesContextProvider>
    ),
  });

describe('useRecentSearches (FR-02)', () => {
  it('shows the stored list on the first render, loaded once', () => {
    const { repository } = createMemoryRepository(['frieren', 'mushishi']);

    const { result, rerender } = renderRecentSearches(repository);

    expect(result.current.searches).toStrictEqual(['frieren', 'mushishi']);

    rerender();

    expect(repository.load).toHaveBeenCalledTimes(1);
  });

  it('adds a search on top and stores the new list', () => {
    const memory = createMemoryRepository(['mushishi']);
    const { result } = renderRecentSearches(memory.repository);

    act(() => {
      result.current.add('Frieren');
    });

    expect(result.current.searches).toStrictEqual(['Frieren', 'mushishi']);
    expect(memory.repository.save).toHaveBeenCalledTimes(1);
    expect(memory.stored()).toStrictEqual(['Frieren', 'mushishi']);
  });

  it('moves a search already listed, ignoring case, to the top with its new casing', () => {
    const { repository } = createMemoryRepository(['monster', 'frieren', 'mushishi']);
    const { result } = renderRecentSearches(repository);

    act(() => {
      result.current.add('FRIEREN');
    });

    expect(result.current.searches).toStrictEqual(['FRIEREN', 'monster', 'mushishi']);
  });

  it('applies two adds made before a render, from the latest list', () => {
    const memory = createMemoryRepository();
    const { result } = renderRecentSearches(memory.repository);

    act(() => {
      result.current.add('frieren');
      result.current.add('mushishi');
    });

    expect(result.current.searches).toStrictEqual(['mushishi', 'frieren']);
    expect(memory.stored()).toStrictEqual(['mushishi', 'frieren']);
  });

  it(`keeps the ${String(RECENT_SEARCHES_MAX)} newest searches`, () => {
    const full = Array.from(
      { length: RECENT_SEARCHES_MAX },
      (_, index) => `query ${String(index)}`,
    );
    const { repository } = createMemoryRepository(full);
    const { result } = renderRecentSearches(repository);

    act(() => {
      result.current.add('newest');
    });

    expect(result.current.searches).toHaveLength(RECENT_SEARCHES_MAX);
    expect(result.current.searches[0]).toBe('newest');
    expect(result.current.searches).not.toContain(full.at(-1));
  });

  it('stores before showing: a failed save leaves the list as it was', () => {
    const { repository } = createMemoryRepository(['mushishi']);
    repository.save.mockImplementation(() => {
      throw new Error(SAVE_FAILURE);
    });
    const { result } = renderRecentSearches(repository);

    expect(() => {
      result.current.add('frieren');
    }).toThrow(SAVE_FAILURE);
    expect(result.current.searches).toStrictEqual(['mushishi']);
  });

  it('clears the list and the stored one', () => {
    const memory = createMemoryRepository(['frieren', 'mushishi']);
    const { result } = renderRecentSearches(memory.repository);

    act(() => {
      result.current.clear();
    });

    expect(result.current.searches).toStrictEqual([]);
    expect(memory.repository.clear).toHaveBeenCalledTimes(1);
    expect(memory.stored()).toStrictEqual([]);

    act(() => {
      result.current.add('monster');
    });

    expect(result.current.searches).toStrictEqual(['monster']);
  });

  it('persists: a new instance over the same repository shows the saved list', () => {
    const memory = createMemoryRepository();
    const first = renderRecentSearches(memory.repository);

    act(() => {
      first.result.current.add('frieren');
    });
    first.unmount();
    const second = renderRecentSearches(memory.repository);

    expect(second.result.current.searches).toStrictEqual(['frieren']);
  });

  it('keeps add and clear stable, and the value while nothing changes', () => {
    const { repository } = createMemoryRepository(['frieren']);
    const { result, rerender } = renderRecentSearches(repository);
    const before = result.current;

    rerender();

    expect(result.current).toBe(before);

    act(() => {
      result.current.add('mushishi');
    });

    expect(result.current.add).toBe(before.add);
    expect(result.current.clear).toBe(before.clear);
  });

  it('throws outside RecentSearchesContextProvider', () => {
    expect(() => renderHook(useRecentSearches)).toThrow(MISSING_RECENT_SEARCHES_PROVIDER_MESSAGE);
  });
});
