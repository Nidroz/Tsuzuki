import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  createDeferred,
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import {
  ENTRY_KEY,
  entryOf,
  entryWithMedia,
  keyOf,
  SNAPSHOT,
} from '../../../test/core/library-entry-fixtures';
import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider } from '../catalog/catalog-provider';
import type { LibraryEntry } from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import type { MediaIdNamespace } from '../domain/media';
import {
  DEFAULT_LIBRARY_VIEW,
  type LibraryView,
  type LibraryViewOptions,
} from '../domain/library-view';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { CatalogContextProvider } from './CatalogContextProvider';
import { LibraryContextProvider } from './LibraryContextProvider';
import { useLibraryEntryActions } from './use-library-entry-actions';
import { useLibraryList } from './use-library-list';

const MANGA_KEY = keyOf('manga', 2);
// on a cdn host of the fake provider (FAKE_IMAGE_HOSTS)
const ALLOWED_COVER = 'https://images.fake.test/images/3.jpg';

// the cover of SNAPSHOT is on a host the fake provider does not serve
const FRIEREN = entryOf();
const MANGA = entryOf({ key: MANGA_KEY, status: 'planned', progress: 0, startedAt: null });
const AKIRA = entryWithMedia(
  { title: 'Akira', imageUrl: ALLOWED_COVER },
  { key: keyOf('anime', 3), score: null },
);
const ADULT = entryWithMedia(
  { title: 'Adult title', isAdult: true },
  { key: keyOf('anime', 4), status: 'completed' },
);
const LIBRARY = [FRIEREN, MANGA, AKIRA, ADULT];

const LIST_FAILURE = new Error('storage is unreadable');
// one layout generation: the layout rule has its own tests (use-library-list-layout.test.tsx)
const LAYOUT_KEY = 0;

interface ListProps {
  readonly options: LibraryViewOptions;
  readonly showAdult: boolean;
}

const render = (
  initialProps: ListProps,
  repository: FakeLibraryRepository = createFakeLibraryRepository(LIBRARY),
  provider: CatalogProvider = createFakeCatalogProvider(),
) => {
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>
        <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(
    ({ options, showAdult }: ListProps) => ({
      list: useLibraryList(options, { showAdult, layoutKey: LAYOUT_KEY }),
      // a list row's actions: no catalog data, the entry seeded by the list
      row: useLibraryEntryActions(MANGA_KEY, { media: null }),
    }),
    { initialProps, wrapper },
  );
  return { ...rendered, queryClient, repository };
};

const loaded = async (rendered: ReturnType<typeof render>): Promise<LibraryView> => {
  await waitFor(() => {
    expect(rendered.result.current.list.query.isSuccess).toBe(true);
  });
  const view = rendered.result.current.list.view;
  if (view === undefined) {
    throw new Error('the library view is not loaded');
  }
  return view;
};

const titlesOf = (view: LibraryView) =>
  view.groups.map((group) => [group.status, group.entries.map((entry) => entry.media.title)]);

describe('useLibraryList (FR-14)', () => {
  it('filters, sorts and groups the entries by the options', async () => {
    const rendered = render({
      options: { status: 'all', kind: 'anime', sort: 'title' },
      showAdult: true,
    });

    const view = await loaded(rendered);

    expect(titlesOf(view)).toStrictEqual([
      ['current', ['Akira', SNAPSHOT.title]],
      ['completed', ['Adult title']],
    ]);
    expect(view).toMatchObject({ visibleCount: 3, hiddenCount: 0, totalCount: LIBRARY.length });
  });

  it('hides and counts the adult entries while the setting is off (BR-06)', async () => {
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: false });

    const view = await loaded(rendered);

    expect(view).toMatchObject({ visibleCount: 3, hiddenCount: 1 });

    rendered.rerender({ options: DEFAULT_LIBRARY_VIEW, showAdult: true });

    expect(rendered.result.current.list.view).toMatchObject({ visibleCount: 4, hiddenCount: 0 });
  });

  it('nulls a cover off the provider hosts, keeping the entry and the cached data', async () => {
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: true });

    const view = await loaded(rendered);
    const shown = view.groups.flatMap((group) => group.entries);

    expect(shown.find((entry) => entry.key === ENTRY_KEY)?.media.imageUrl).toBeNull();
    expect(shown.find((entry) => entry.key === AKIRA.key)).toBe(AKIRA);
    expect(
      rendered.queryClient.getQueryData<readonly LibraryEntry[]>(queryKeys.library.all()),
    ).toStrictEqual(LIBRARY);
  });

  it("nulls every cover of an entry stored by another provider's namespace", async () => {
    // the only namespace today is 'mal': a provider of another one needs a cast, test only
    const provider = {
      ...createFakeCatalogProvider(),
      namespace: 'other' as MediaIdNamespace,
    };
    const rendered = render(
      { options: DEFAULT_LIBRARY_VIEW, showAdult: true },
      createFakeLibraryRepository(LIBRARY),
      provider,
    );

    const shown = (await loaded(rendered)).groups.flatMap((group) => group.entries);

    // the cover of AKIRA is on the provider's hosts, yet not of its namespace
    expect(shown.find((entry) => entry.key === AKIRA.key)?.media).toStrictEqual({
      ...AKIRA.media,
      imageUrl: null,
    });
    expect(shown.map((entry) => entry.media.imageUrl)).toStrictEqual(LIBRARY.map(() => null));
  });

  it('selects again on an option change, never refetching', async () => {
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: true });
    const before = await loaded(rendered);

    rendered.rerender({ options: { ...DEFAULT_LIBRARY_VIEW }, showAdult: true });

    expect(rendered.result.current.list.view).toBe(before);

    rendered.rerender({ options: { ...DEFAULT_LIBRARY_VIEW, status: 'planned' }, showAdult: true });

    expect(titlesOf(await loaded(rendered))).toStrictEqual([['planned', [MANGA.media.title]]]);
    expect(rendered.repository.list).toHaveBeenCalledTimes(1);
  });

  it('shows a row action at once, then refetches the list after the write', async () => {
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: true });
    await loaded(rendered);
    const scoreOfManga = () =>
      rendered.result.current.list.view?.groups
        .flatMap((group) => group.entries)
        .find((entry) => entry.key === MANGA_KEY)?.score;

    const held = createDeferred();
    rendered.repository.beforeCall.mockReturnValueOnce(held.promise);

    await act(async () => {
      rendered.result.current.row.setScore(3);
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(scoreOfManga()).toBe(3);
    expect(rendered.repository.stored(MANGA_KEY)?.score).toBe(MANGA.score);
    expect(rendered.repository.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(rendered.repository.list).toHaveBeenCalledTimes(2);
    });
    expect(rendered.result.current.row.error).toBeNull();
    expect(rendered.repository.stored(MANGA_KEY)?.score).toBe(3);
  });

  it('writes three coalesced row `+1` taps once, whatever list refetches run between (BR-09)', async () => {
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: true });
    await loaded(rendered);
    const shownManga = () =>
      rendered.result.current.list.view?.groups
        .flatMap((group) => group.entries)
        .find((entry) => entry.key === MANGA_KEY);

    for (let tap = 0; tap < 3; tap += 1) {
      await act(async () => {
        rendered.result.current.row.incrementProgress();
        await rendered.result.current.list.query.refetch();
        // each tap restarts the window: still pending after it
        await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS - 1);
      });
    }

    expect(rendered.repository.list).toHaveBeenCalledTimes(4);
    expect(shownManga()).toMatchObject({ status: 'current', progress: 3 });
    expect(rendered.repository.save).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });

    expect(rendered.repository.save).toHaveBeenCalledTimes(1);
    expect(rendered.repository.stored(MANGA_KEY)).toMatchObject({
      status: 'current',
      progress: 3,
      media: MANGA.media,
    });
  });

  it('is an error when the library cannot be read', async () => {
    const repository = createFakeLibraryRepository(LIBRARY);
    repository.list.mockRejectedValueOnce(LIST_FAILURE);
    const rendered = render({ options: DEFAULT_LIBRARY_VIEW, showAdult: true }, repository);

    await waitFor(() => {
      expect(rendered.result.current.list.query.isError).toBe(true);
    });
    expect(rendered.result.current.list.query.error).toBe(LIST_FAILURE);
  });
});
