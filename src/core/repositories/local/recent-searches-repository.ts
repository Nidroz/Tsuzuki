// the recent searches of FR-02 on the device (docs/ARCHITECTURE.md §6), over the synchronous
// StorageAdapter. personal data: never logged, never put in an error
import { z } from 'zod';

import { normalizeRecentSearches } from '../../domain/recent-searches';
import { isSearchQueryMaxLength, prepareSearchQuery } from '../../domain/search-query';
import type { RecentSearchesRepository } from '../recent-searches-repository';
import type { StorageAdapter } from '../storage-adapter';

/** storage key of the recent searches, a json array of strings. */
export const RECENT_SEARCHES_STORAGE_KEY = 'recent-searches';

export interface LocalRecentSearchesOptions {
  /** the search text limit of the catalog provider (`CatalogProvider.searchQueryMaxLength`). */
  readonly maxQueryLength: number;
}

// stored content is untrusted: the envelope is checked here, every entry below
const storedSearchesSchema = z.array(z.unknown());

const parseStored = (stored: string): readonly unknown[] => {
  try {
    const result = storedSearchesSchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : [];
  } catch {
    // invalid json: the list starts over, like a value that is not an array
    return [];
  }
};

/**
 * recent searches stored under RECENT_SEARCHES_STORAGE_KEY. `load` keeps only the entries that are
 * already prepared queries for `maxQueryLength` (strings, trimmed, within the limit, well-formed),
 * then applies the domain rules. throws a RangeError when `maxQueryLength` is not a positive safe
 * integer.
 */
export const createLocalRecentSearchesRepository = (
  storage: StorageAdapter,
  { maxQueryLength }: LocalRecentSearchesOptions,
): RecentSearchesRepository => {
  if (!isSearchQueryMaxLength(maxQueryLength)) {
    throw new RangeError('Recent searches max query length must be a positive safe integer');
  }
  const isPreparedQuery = (entry: unknown): entry is string =>
    typeof entry === 'string' && prepareSearchQuery(entry, maxQueryLength) === entry;

  return {
    load: () => {
      const stored = storage.getString(RECENT_SEARCHES_STORAGE_KEY);
      if (stored === undefined) {
        return [];
      }
      return normalizeRecentSearches(parseStored(stored).filter(isPreparedQuery));
    },
    save: (searches) => {
      storage.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(searches));
    },
    clear: () => {
      storage.delete(RECENT_SEARCHES_STORAGE_KEY);
    },
  };
};
