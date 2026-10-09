import type { CatalogProviderId } from '../catalog/catalog-provider-id';
import type { MediaKey, MediaKind } from '../domain/media';

// query keys are built only here: readonly tuples of primitives, so they hash and compare stably.
// a key that starts with another one is covered when the shorter one is invalidated
export const queryKeys = {
  media: (kind: MediaKind, malId: number) => ['media', kind, malId] as const,
  top: (provider: CatalogProviderId, kind: MediaKind, page: number) =>
    ['top', provider, kind, page] as const,
  season: (provider: CatalogProviderId, page: number) => ['season', provider, page] as const,
  genres: (provider: CatalogProviderId, kind: MediaKind) => ['genres', provider, kind] as const,
  library: {
    all: () => ['library'] as const,
    // starts with all(): invalidating the library refetches every entry
    entry: (key: MediaKey) => ['library', key.kind, key.malId] as const,
  },
} as const;
