import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { entryWithMedia, keyOf } from '../../../test/core/library-entry-fixtures';
import { switchableLibraryWrapper } from '../../../test/core/library-hooks-support';
import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { LibraryEntry } from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import type { MediaKey } from '../domain/media';
import {
  DEFAULT_LIBRARY_VIEW,
  type LibraryView,
  type LibraryViewOptions,
} from '../domain/library-view';
import { createQueryClient } from '../query/query-client';
import { CatalogContextProvider } from './CatalogContextProvider';
import { LibraryContextProvider } from './LibraryContextProvider';
import { useLibraryEntryActions } from './use-library-entry-actions';
import { useLibraryList } from './use-library-list';

// fR-14, FR-12: the library list keeps the layout last shown while the user acts on it, and lays
// the library out again on a new layout key or option

// three entries in progress, the last change first, and a planned one, all changed before the
// fixed clock (FIXED_NOW): a `+1` makes its entry the last change
const ALPHA = entryWithMedia(
  { title: 'Alpha' },
  { key: keyOf('anime', 1), updatedAt: '2025-12-03T10:00:00.000Z' },
);
const BETA = entryWithMedia(
  { title: 'Beta' },
  { key: keyOf('anime', 2), updatedAt: '2025-12-02T10:00:00.000Z' },
);
const GAMMA = entryWithMedia(
  { title: 'Gamma' },
  { key: keyOf('anime', 3), updatedAt: '2025-12-01T10:00:00.000Z' },
);
const PLANNED = entryWithMedia(
  { title: 'Delta' },
  {
    key: keyOf('anime', 4),
    status: 'planned',
    progress: 0,
    startedAt: null,
    updatedAt: '2025-11-30T10:00:00.000Z',
  },
);
const LIBRARY = [ALPHA, BETA, GAMMA, PLANNED];
// the last change of the library before any `+1`: first of the in-progress entries
const ADULT = entryWithMedia(
  { title: 'Adult title', isAdult: true },
  { key: keyOf('anime', 5), updatedAt: '2025-12-04T10:00:00.000Z' },
);

const PLANNED_ONLY: LibraryViewOptions = { ...DEFAULT_LIBRARY_VIEW, status: 'planned' };

interface ListProps {
  readonly options: LibraryViewOptions;
  readonly layoutKey: number;
  /** the adult content setting (BR-06), on when absent */
  readonly showAdult?: boolean;
}

// the list of `library`, and the actions of the row of `key`
const render = (key: MediaKey, initialProps: ListProps, library = LIBRARY) => {
  const queryClient = createQueryClient();
  const repository = createFakeLibraryRepository(library);
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={createFakeCatalogProvider()}>
        <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(
    ({ options, layoutKey, showAdult = true }: ListProps) => ({
      list: useLibraryList(options, { showAdult, layoutKey }),
      row: useLibraryEntryActions(key, { media: null }),
    }),
    { initialProps, wrapper },
  );
  return { ...rendered, repository };
};

type Rendered = ReturnType<typeof render>;

const shownView = (rendered: Rendered): LibraryView => {
  const { view } = rendered.result.current.list;
  if (view === undefined) {
    throw new Error('the library view is not loaded');
  }
  return view;
};

const loaded = async (rendered: Rendered): Promise<void> => {
  await waitFor(() => {
    expect(rendered.result.current.list.view).toBeDefined();
  });
};

const titlesOf = (rendered: Rendered) =>
  shownView(rendered).groups.map((group) => [
    group.status,
    group.entries.map((entry) => entry.media.title),
  ]);

const shownEntry = (rendered: Rendered, key: MediaKey): LibraryEntry | undefined =>
  shownView(rendered)
    .groups.flatMap((group) => group.entries)
    .find((entry) => entry.key.externalId === key.externalId);

// a `+1` of the row, its coalesced write and the list refetch after it settled
const incrementAndSettle = async (rendered: Rendered, taps: number) => {
  for (let tap = 0; tap < taps; tap += 1) {
    await act(async () => {
      rendered.result.current.row.incrementProgress();
      await jest.advanceTimersByTimeAsync(0);
    });
  }
  await act(async () => {
    await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
  });
  await waitFor(() => {
    expect(rendered.repository.list).toHaveBeenCalledTimes(2);
  });
};

const IN_PROGRESS_ORDER = ['current', ['Alpha', 'Beta', 'Gamma']];

describe('useLibraryList layout', () => {
  it('keeps the order when a row that is not first gets `+1`, the taps landing on it', async () => {
    const rendered = render(BETA.key, { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0 });
    await loaded(rendered);

    await incrementAndSettle(rendered, 2);

    expect(titlesOf(rendered)).toStrictEqual([IN_PROGRESS_ORDER, ['planned', ['Delta']]]);
    expect(shownEntry(rendered, BETA.key)?.progress).toBe(BETA.progress + 2);
    for (const other of [ALPHA, GAMMA]) {
      expect(shownEntry(rendered, other.key)).toMatchObject({
        progress: other.progress,
        updatedAt: other.updatedAt,
      });
    }
    expect(rendered.repository.stored(BETA.key)?.progress).toBe(BETA.progress + 2);
  });

  it('lays the library out again on a new layout key', async () => {
    const rendered = render(BETA.key, { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0 });
    await loaded(rendered);
    await incrementAndSettle(rendered, 1);

    rendered.rerender({ options: DEFAULT_LIBRARY_VIEW, layoutKey: 1 });

    expect(titlesOf(rendered)).toStrictEqual([
      ['current', ['Beta', 'Alpha', 'Gamma']],
      ['planned', ['Delta']],
    ]);
  });

  it('lays the library out again on an option change', async () => {
    const rendered = render(BETA.key, { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0 });
    await loaded(rendered);
    await incrementAndSettle(rendered, 1);

    // every entry is an anime: the same entries, laid out again
    rendered.rerender({ options: { ...DEFAULT_LIBRARY_VIEW, kind: 'anime' }, layoutKey: 0 });

    expect(titlesOf(rendered)).toStrictEqual([
      ['current', ['Beta', 'Alpha', 'Gamma']],
      ['planned', ['Delta']],
    ]);
  });

  it('lays the library out again on a status filter change', async () => {
    const rendered = render(BETA.key, { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0 });
    await loaded(rendered);
    await incrementAndSettle(rendered, 1);

    // a kept layout would still show the planned entry, and Beta in its old place
    rendered.rerender({ options: { ...DEFAULT_LIBRARY_VIEW, status: 'current' }, layoutKey: 0 });

    expect(titlesOf(rendered)).toStrictEqual([['current', ['Beta', 'Alpha', 'Gamma']]]);
    expect(shownView(rendered).visibleCount).toBe(3);
  });

  it('lays the library out again when the adult content setting turns off, hiding the adult entries it showed (BR-06)', async () => {
    const rendered = render(
      BETA.key,
      { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0, showAdult: true },
      [...LIBRARY, ADULT],
    );
    await loaded(rendered);
    await incrementAndSettle(rendered, 1);

    expect(titlesOf(rendered)).toStrictEqual([
      ['current', ['Adult title', 'Alpha', 'Beta', 'Gamma']],
      ['planned', ['Delta']],
    ]);

    rendered.rerender({ options: DEFAULT_LIBRARY_VIEW, layoutKey: 0, showAdult: false });

    expect(titlesOf(rendered)).toStrictEqual([
      ['current', ['Beta', 'Alpha', 'Gamma']],
      ['planned', ['Delta']],
    ]);
    expect(shownView(rendered)).toMatchObject({ visibleCount: 4, hiddenCount: 1, totalCount: 5 });
  });

  it('keeps a planned entry turned current under the planned filter until laid out again (BR-02)', async () => {
    const rendered = render(PLANNED.key, { options: PLANNED_ONLY, layoutKey: 0 });
    await loaded(rendered);

    await incrementAndSettle(rendered, 1);

    expect(titlesOf(rendered)).toStrictEqual([['planned', ['Delta']]]);
    expect(shownEntry(rendered, PLANNED.key)).toMatchObject({ status: 'current', progress: 1 });

    rendered.rerender({ options: PLANNED_ONLY, layoutKey: 1 });

    expect(titlesOf(rendered)).toStrictEqual([]);
    expect(shownView(rendered).visibleCount).toBe(0);
  });

  it('drops a removed entry at once, keeping the others in place', async () => {
    const rendered = render(BETA.key, { options: DEFAULT_LIBRARY_VIEW, layoutKey: 0 });
    await loaded(rendered);

    await act(async () => {
      rendered.result.current.row.remove();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(titlesOf(rendered)).toStrictEqual([
      ['current', ['Alpha', 'Gamma']],
      ['planned', ['Delta']],
    ]);
  });
});

describe('useLibraryList layout across libraries (A-03)', () => {
  it('lays out another library afresh, whatever layout the previous one kept', async () => {
    // the next library holds the same media, Beta changed last there
    const nextBeta = { ...BETA, updatedAt: '2025-12-05T10:00:00.000Z' };
    const next = createFakeLibraryRepository([ALPHA, nextBeta, GAMMA, PLANNED]);
    const { wrapper, switchTo } = switchableLibraryWrapper(
      createQueryClient(),
      createFakeLibraryRepository(LIBRARY),
    );
    const rendered = renderHook(
      () => useLibraryList(DEFAULT_LIBRARY_VIEW, { showAdult: true, layoutKey: 0 }),
      { wrapper },
    );
    await waitFor(() => {
      expect(rendered.result.current.view?.groups[0]?.entries).toHaveLength(3);
    });

    act(() => {
      switchTo(next);
      rendered.rerender();
    });
    await waitFor(() => {
      expect(rendered.result.current.view).toBeDefined();
    });

    // a kept layout would show Alpha first, as the previous library did
    expect(
      rendered.result.current.view?.groups.map((group) =>
        group.entries.map((entry) => entry.media.title),
      ),
    ).toStrictEqual([['Beta', 'Alpha', 'Gamma'], ['Delta']]);
  });
});
