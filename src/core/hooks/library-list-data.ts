// the cached data of the library list query (queryKeys.library.all(scope)), kept in step with the
// optimistic entries of the library writer (library-writer.ts, docs/ARCHITECTURE.md §6 "Writes").
// entries and keys are personal data: never logged
import type { QueryClient } from '@tanstack/react-query';

import type { LibraryEntry } from '../domain/library-entry';
import { compareMediaKeys, type MediaKey } from '../domain/media';
import { queryKeys, type LibraryScope } from '../query/keys';

/** a stable id of a media, whatever the scope: the json of its namespace, kind and external id */
export const mediaKeyId = (key: MediaKey): string =>
  JSON.stringify([key.namespace, key.kind, key.externalId]);

// findIndex of an entry not in the list
const NOT_FOUND = -1;

/**
 * `list` with the entry of `key` set to `entry`: replaced in place, inserted at the front when
 * absent, dropped for null. never mutates `list`
 */
export const withListEntry = (
  list: readonly LibraryEntry[],
  key: MediaKey,
  entry: LibraryEntry | null,
): readonly LibraryEntry[] => {
  const index = list.findIndex((listed) => compareMediaKeys(listed.key, key) === 0);
  if (index === NOT_FOUND) {
    return entry === null ? list : [entry, ...list];
  }
  return entry === null
    ? list.filter((_, at) => at !== index)
    : list.map((listed, at) => (at === index ? entry : listed));
};

/** sets the entry of `key` in the cached list of `scope`, when that list query has data */
export const setListEntry = (
  queryClient: QueryClient,
  scope: LibraryScope,
  key: MediaKey,
  entry: LibraryEntry | null,
): void => {
  const listKey = queryKeys.library.all(scope);
  const list = queryClient.getQueryData<readonly LibraryEntry[]>(listKey);
  if (list !== undefined) {
    queryClient.setQueryData(listKey, withListEntry(list, key, entry));
  }
};
