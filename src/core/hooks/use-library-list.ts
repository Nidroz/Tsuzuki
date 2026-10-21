import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { toAllowedImageUrl } from '../catalog/image-url';
import type { LibraryEntry } from '../domain/library-entry';
import {
  buildLibraryView,
  keepLibraryLayout,
  libraryEntryId,
  type LibraryKindFilter,
  type LibrarySortField,
  type LibraryStatusFilter,
  type LibraryView,
  type LibraryViewOptions,
} from '../domain/library-view';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { useCatalogProvider } from './use-catalog-provider';
import { useLibraryContext } from './use-library-context';

export interface UseLibraryListOptions {
  /** the adult content setting (BR-06): off, the adult entries are hidden and counted */
  readonly showAdult: boolean;
  /**
   * the layout generation: while it and the options stay the same, the view keeps the layout last
   * shown (keepLibraryLayout); a new value lays the library out again. the library screen bumps it
   * when it gains focus
   */
  readonly layoutKey: number | string;
}

/** the library read, selected for display: the view of the options and every entry by id */
export interface LibrarySelection {
  /** the library laid out by the options, as if nothing were shown yet */
  readonly fresh: LibraryView;
  /** every entry of the library by libraryEntryId, whatever the filters, covers filtered */
  readonly current: ReadonlyMap<string, LibraryEntry>;
}

export interface LibraryListResult {
  /** the library read: its status, error and refetch. its data is the selection, not frozen */
  readonly query: UseQueryResult<LibrarySelection>;
  /** the view to show, laid out like the view last shown; undefined until the library is read */
  readonly view: LibraryView | undefined;
}

type SelectLibrary = (entries: readonly LibraryEntry[]) => LibrarySelection;

// the provider of the covers: its namespace (a string: compared with the namespace of entries
// stored by any provider) and its cdn hosts
interface CoverSource {
  readonly namespace: string;
  readonly imageHosts: readonly string[];
}

// what a shown view was laid out for: the same values keep its layout
interface LayoutScope {
  readonly layoutKey: number | string;
  readonly status: LibraryStatusFilter;
  readonly kind: LibraryKindFilter;
  readonly sort: LibrarySortField;
  readonly showAdult: boolean;
}

interface ShownView extends LayoutScope {
  readonly selection: LibrarySelection;
  readonly view: LibraryView;
}

// a stored cover is untrusted (CONTRIBUTING.md §7): kept on a cdn host of the entry's provider
// only, else null. a display copy, the entry itself when the cover is kept
const withAllowedCover = (entry: LibraryEntry, source: CoverSource): LibraryEntry => {
  const imageUrl =
    entry.key.namespace === source.namespace
      ? toAllowedImageUrl(entry.media.imageUrl, source.imageHosts)
      : null;
  return imageUrl === entry.media.imageUrl
    ? entry
    : { ...entry, media: { ...entry.media, imageUrl } };
};

const selectLibrary =
  (options: LibraryViewOptions, showAdult: boolean, source: CoverSource): SelectLibrary =>
  (entries) => {
    // display copies: the cached entries are untouched
    const shown = entries.map((entry) => withAllowedCover(entry, source));
    return {
      fresh: buildLibraryView(shown, options, showAdult),
      current: new Map(shown.map((entry) => [libraryEntryId(entry.key), entry])),
    };
  };

const sameScope = (a: LayoutScope, b: LayoutScope): boolean =>
  a.layoutKey === b.layoutKey &&
  a.status === b.status &&
  a.kind === b.kind &&
  a.sort === b.sort &&
  a.showAdult === b.showAdult;

/**
 * the library as the library screen shows it (FR-14): every entry read through the library
 * writer (optimistic entries included), filtered, sorted and grouped by `options`, the adult
 * entries hidden unless `showAdult` (BR-06), each cover kept on the catalog provider's hosts only
 * (null otherwise, the entry still listed). always revalidated (STALE_TIMES.library); a change of
 * the options or the setting selects again and never refetches. the cached entries are untouched.
 * while `layoutKey`, the options and the setting stay the same, a change of the library keeps the
 * layout last shown (keepLibraryLayout): a row acted on stays where it is, with its new values
 */
export const useLibraryList = (
  options: LibraryViewOptions,
  { showAdult, layoutKey }: UseLibraryListOptions,
): LibraryListResult => {
  const { writer } = useLibraryContext();
  const { namespace, imageHosts } = useCatalogProvider();
  const { status, kind, sort } = options;
  // one selection per option values: the query reruns it only when its data or one of them changes
  const select = useMemo(
    () => selectLibrary({ status, kind, sort }, showAdult, { namespace, imageHosts }),
    [status, kind, sort, showAdult, namespace, imageHosts],
  );
  const query = useQuery({
    queryKey: queryKeys.library.all(),
    queryFn: () => writer.list(),
    staleTime: STALE_TIMES.library,
    select,
  });

  // the view last shown, with the selection and the scope it was laid out from: state adjusted
  // while rendering (react's "storing information from previous renders"). not a ref, which is
  // not read during render, nor an effect, which would render every change twice. an update made
  // by a render react discards or replays (strict mode, concurrent rendering) goes with it, so
  // the layout kept is always one rendered. a render of the same selection and scope reuses the
  // view, so the update stops there
  const [shown, setShown] = useState<ShownView | null>(null);
  const selection = query.data;
  const scope: LayoutScope = { layoutKey, status, kind, sort, showAdult };
  const inScope = shown !== null && sameScope(shown, scope);
  let view: LibraryView | undefined;
  if (selection === undefined) {
    view = undefined;
  } else if (inScope && shown.selection === selection) {
    view = shown.view;
  } else {
    view = keepLibraryLayout(selection.fresh, selection.current, inScope ? shown.view : null);
    setShown({ ...scope, selection, view });
  }

  return { query, view };
};
