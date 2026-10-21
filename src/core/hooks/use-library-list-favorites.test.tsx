import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { entryWithMedia, keyOf } from '../../../test/core/library-entry-fixtures';
import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { LibraryEntry } from '../domain/library-entry';
import { DEFAULT_LIBRARY_VIEW, type LibraryView } from '../domain/library-view';
import type { MediaKey } from '../domain/media';
import { createQueryClient } from '../query/query-client';
import { CatalogContextProvider } from './CatalogContextProvider';
import { LibraryContextProvider } from './LibraryContextProvider';
import { useLibraryEntryActions } from './use-library-entry-actions';
import { useLibraryList } from './use-library-list';

// fR-15, BR-06: the favorites view of useLibraryList (favoritesOnly)

const ALPHA = entryWithMedia(
  { title: 'Alpha' },
  { key: keyOf('anime', 1), isFavorite: true, updatedAt: '2025-12-03T10:00:00.000Z' },
);
const BETA = entryWithMedia(
  { title: 'Beta' },
  { key: keyOf('anime', 2), updatedAt: '2025-12-02T10:00:00.000Z' },
);
const GAMMA = entryWithMedia(
  { title: 'Gamma' },
  {
    key: keyOf('manga', 3),
    status: 'planned',
    progress: 0,
    startedAt: null,
    isFavorite: true,
    updatedAt: '2025-12-01T10:00:00.000Z',
  },
);
const ADULT_FAVORITE = entryWithMedia(
  { title: 'Adult favorite', isAdult: true },
  { key: keyOf('anime', 4), isFavorite: true, updatedAt: '2025-11-30T10:00:00.000Z' },
);
const ADULT = entryWithMedia({ title: 'Adult title', isAdult: true }, { key: keyOf('anime', 5) });
const LIBRARY = [ALPHA, BETA, GAMMA, ADULT_FAVORITE, ADULT];

interface ListProps {
  readonly showAdult: boolean;
  readonly layoutKey: number;
}

// the favorites list, and the actions of the row of `key`
const render = (key: MediaKey, initialProps: ListProps) => {
  const queryClient = createQueryClient();
  const repository = createFakeLibraryRepository(LIBRARY);
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={createFakeCatalogProvider()}>
        <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(
    ({ showAdult, layoutKey }: ListProps) => ({
      list: useLibraryList(DEFAULT_LIBRARY_VIEW, { showAdult, layoutKey, favoritesOnly: true }),
      row: useLibraryEntryActions(key, { media: null }),
    }),
    { initialProps, wrapper },
  );
  return { ...rendered, repository };
};

type Rendered = ReturnType<typeof render>;

const loaded = async (rendered: Rendered): Promise<LibraryView> => {
  await waitFor(() => {
    expect(rendered.result.current.list.view).toBeDefined();
  });
  return shownView(rendered);
};

const shownView = (rendered: Rendered): LibraryView => {
  const { view } = rendered.result.current.list;
  if (view === undefined) {
    throw new Error('the library view is not loaded');
  }
  return view;
};

const shownEntries = (rendered: Rendered): readonly LibraryEntry[] =>
  shownView(rendered).groups.flatMap((group) => group.entries);

const titlesOf = (rendered: Rendered): readonly string[] =>
  shownEntries(rendered).map((entry) => entry.media.title);

describe('useLibraryList: favorites only (FR-15)', () => {
  it('lists and counts the favorites only', async () => {
    const rendered = render(ALPHA.key, { showAdult: true, layoutKey: 0 });
    const view = await loaded(rendered);

    expect(view.groups.map((group) => group.status)).toStrictEqual(['current', 'planned']);
    expect(titlesOf(rendered)).toStrictEqual(['Alpha', 'Adult favorite', 'Gamma']);
    expect(view).toMatchObject({ visibleCount: 3, hiddenCount: 0, totalCount: 3 });
  });

  it('hides the adult favorites and counts them, never the other adult entries (BR-06)', async () => {
    const rendered = render(ALPHA.key, { showAdult: false, layoutKey: 0 });
    const view = await loaded(rendered);

    expect(titlesOf(rendered)).toStrictEqual(['Alpha', 'Gamma']);
    expect(view).toMatchObject({ visibleCount: 2, hiddenCount: 1, totalCount: 3 });
  });

  it('keeps an unfavorited entry, with its new value, until the list is laid out again', async () => {
    const rendered = render(ALPHA.key, { showAdult: false, layoutKey: 0 });
    await loaded(rendered);

    await act(async () => {
      rendered.result.current.row.toggleFavorite();
      await jest.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(rendered.repository.list).toHaveBeenCalledTimes(2);
    });

    expect(rendered.repository.stored(ALPHA.key)?.isFavorite).toBe(false);
    expect(titlesOf(rendered)).toStrictEqual(['Alpha', 'Gamma']);
    expect(shownEntries(rendered)[0]?.isFavorite).toBe(false);

    rendered.rerender({ showAdult: false, layoutKey: 1 });

    expect(titlesOf(rendered)).toStrictEqual(['Gamma']);
    expect(shownView(rendered)).toMatchObject({ visibleCount: 1, totalCount: 2 });
  });

  it('adds a favorite made meanwhile to the view shown', async () => {
    const rendered = render(BETA.key, { showAdult: true, layoutKey: 0 });
    await loaded(rendered);

    await act(async () => {
      rendered.result.current.row.toggleFavorite();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(titlesOf(rendered)).toContain('Beta');
  });
});
