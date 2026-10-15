import type { SearchParams } from '../catalog/catalog-provider';
import { searchKeyParts } from '../catalog/search-params';
import type { MediaIdNamespace, MediaKey, MediaKind } from '../domain/media';

/** the first element of every search key: the persister skips the keys that start with it. */
export const SEARCH_KEY_ROOT = 'search';

// query keys are built only here: readonly tuples of primitives, so they hash and compare stably.
// a key that starts with another one is covered when the shorter one is invalidated. catalog keys
// hold the id namespace, never a server or instance id: switching instances keeps the cache
export const queryKeys = {
  media: (key: MediaKey) => ['media', key.namespace, key.kind, key.externalId] as const,
  top: (namespace: MediaIdNamespace, kind: MediaKind, page: number) =>
    ['top', namespace, kind, page] as const,
  season: (namespace: MediaIdNamespace, page: number) => ['season', namespace, page] as const,
  // params are normalized first: equivalent searches share one key, page last
  search: (namespace: MediaIdNamespace, params: SearchParams) =>
    [SEARCH_KEY_ROOT, namespace, ...searchKeyParts(params)] as const,
  // the key of a search hook with nothing to search: never fetched (skipToken), never persisted
  searchIdle: (namespace: MediaIdNamespace) => [SEARCH_KEY_ROOT, namespace, 'idle'] as const,
  genres: (namespace: MediaIdNamespace, kind: MediaKind) => ['genres', namespace, kind] as const,
  library: {
    all: () => ['library'] as const,
    // starts with all(): invalidating the library refetches every entry
    entry: (key: MediaKey) => ['library', key.namespace, key.kind, key.externalId] as const,
  },
} as const;
