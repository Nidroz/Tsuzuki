import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { MediaSummary } from '../catalog/catalog-provider';
import type { LibraryEntry, LibraryMediaSnapshot } from '../domain/library-entry';
import { withMediaSnapshot } from '../domain/library-snapshot';
import type { MediaKey } from '../domain/media';
import { queryKeys } from '../query/keys';
import { STALE_TIMES } from '../query/stale-times';
import { toLibraryMediaSnapshot } from '../schemas/library-entry';
import { useLibraryContext } from './use-library-context';

export interface UseLibraryEntryOptions {
  /** the catalog's current data of the media (the detail screen), null when there is none yet */
  readonly media: MediaSummary | null;
}

type SelectEntry = (entry: LibraryEntry | null) => LibraryEntry | null;

const keepEntry: SelectEntry = (entry) => entry;

// one selection per media value: the query reruns it only when its data or the media changes.
// the snapshot is built on the first entry, inside the selection: a media outside the database
// limits (a RangeError) becomes the query error instead of a render crash
const selectWithMedia = (media: MediaSummary): SelectEntry => {
  let snapshot: LibraryMediaSnapshot | undefined;
  return (entry) => {
    if (entry === null) {
      return null;
    }
    snapshot ??= toLibraryMediaSnapshot(media);
    return withMediaSnapshot(entry, snapshot);
  };
};

/**
 * the library entry of the media `key`, null when the media is not in the library, read through
 * the library writer, so a refetch never returns a state older than a write. always revalidated
 * (STALE_TIMES.library). with `media`, the entry is shown with the catalog's current snapshot
 * (withMediaSnapshot): the fresh total enables `+1` and bounds the progress (BR-01). viewing
 * writes nothing; the snapshot is written with the next action (useLibraryEntryActions)
 */
export const useLibraryEntry = (
  key: MediaKey,
  { media }: UseLibraryEntryOptions,
): UseQueryResult<LibraryEntry | null> => {
  const { writer } = useLibraryContext();
  const select = useMemo(() => (media === null ? keepEntry : selectWithMedia(media)), [media]);
  return useQuery({
    queryKey: queryKeys.library.entry(key),
    queryFn: () => writer.read(key),
    staleTime: STALE_TIMES.library,
    select,
  });
};
