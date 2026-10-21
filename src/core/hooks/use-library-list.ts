import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { toAllowedImageUrl } from '../catalog/image-url';
import type { LibraryEntry } from '../domain/library-entry';
import {
  buildLibraryView,
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
}

type SelectView = (entries: readonly LibraryEntry[]) => LibraryView;

// the provider of the covers: its namespace (a string: compared with the namespace of entries
// stored by any provider) and its cdn hosts
interface CoverSource {
  readonly namespace: string;
  readonly imageHosts: readonly string[];
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

const selectView =
  (options: LibraryViewOptions, showAdult: boolean, source: CoverSource): SelectView =>
  (entries) => {
    const view = buildLibraryView(entries, options, showAdult);
    return {
      ...view,
      groups: view.groups.map((group) => ({
        ...group,
        entries: group.entries.map((entry) => withAllowedCover(entry, source)),
      })),
    };
  };

/**
 * the library as the library screen shows it (FR-14): every entry read through the library
 * writer (optimistic entries included), filtered, sorted and grouped by `options`, the adult
 * entries hidden unless `showAdult` (BR-06), each cover kept on the catalog provider's hosts only
 * (null otherwise, the entry still listed). always revalidated (STALE_TIMES.library); a change of
 * the options or the setting selects again and never refetches. the cached entries are untouched
 */
export const useLibraryList = (
  options: LibraryViewOptions,
  { showAdult }: UseLibraryListOptions,
): UseQueryResult<LibraryView> => {
  const { writer } = useLibraryContext();
  const { namespace, imageHosts } = useCatalogProvider();
  const { status, kind, sort } = options;
  // one selection per option values: the query reruns it only when its data or one of them changes
  const select = useMemo(
    () => selectView({ status, kind, sort }, showAdult, { namespace, imageHosts }),
    [status, kind, sort, showAdult, namespace, imageHosts],
  );
  return useQuery({
    queryKey: queryKeys.library.all(),
    queryFn: () => writer.list(),
    staleTime: STALE_TIMES.library,
    select,
  });
};
