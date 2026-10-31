import type { SearchParams, TopParams } from '../catalog/catalog-provider';
import { searchKeyParts } from '../catalog/search-params';
import type { MediaIdNamespace, MediaKey, MediaKind } from '../domain/media';

/** the first element of every search key: the persister skips the keys that start with it. */
export const SEARCH_KEY_ROOT = 'search';

/** the first element of every library key: the persister skips the keys that start with it. */
export const LIBRARY_KEY_ROOT = 'library';

declare const libraryScopeBrand: unique symbol;

/**
 * the cache scope of one library writer (docs/ARCHITECTURE.md §6 "Query keys", "Writes"): every
 * library key holds it, so the keys of one library never meet those of another. a number, since a
 * query key holds primitives only (TanStack hashes keys as json, where a symbol reads as null),
 * opaque to callers: made with toLibraryScope, compared for equality only.
 */
export type LibraryScope = number & { readonly [libraryScopeBrand]: true };

/** the scope of `value`, a non-negative safe integer; anything else throws a RangeError. */
export const toLibraryScope = (value: number): LibraryScope => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('library scope must be a non-negative safe integer');
  }
  return value as LibraryScope;
};

// query keys are built only here: readonly tuples of primitives, so they hash and compare stably.
// a key that starts with another one is covered when the shorter one is invalidated. catalog keys
// hold the id namespace, never a server or instance id: switching instances keeps the cache
export const queryKeys = {
  media: (key: MediaKey) => ['media', key.namespace, key.kind, key.externalId] as const,
  // an absent format (every format) is null, page last
  top: (namespace: MediaIdNamespace, { kind, format, page }: TopParams) =>
    ['top', namespace, kind, format ?? null, page] as const,
  season: (namespace: MediaIdNamespace, page: number) => ['season', namespace, page] as const,
  // params are normalized first: equivalent searches share one key, page last
  search: (namespace: MediaIdNamespace, params: SearchParams) =>
    [SEARCH_KEY_ROOT, namespace, ...searchKeyParts(params)] as const,
  // the key of a search hook with nothing to search: never fetched (skipToken), never persisted
  searchIdle: (namespace: MediaIdNamespace) => [SEARCH_KEY_ROOT, namespace, 'idle'] as const,
  genres: (namespace: MediaIdNamespace, kind: MediaKind) => ['genres', namespace, kind] as const,
  library: {
    // the list query of one library writer's scope
    all: (scope: LibraryScope) => [LIBRARY_KEY_ROOT, scope] as const,
    // starts with all(scope): removing or invalidating a scope covers its list and every entry
    entry: (scope: LibraryScope, key: MediaKey) =>
      [LIBRARY_KEY_ROOT, scope, key.namespace, key.kind, key.externalId] as const,
  },
} as const;
