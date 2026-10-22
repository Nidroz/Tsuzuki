import type { DehydratedState } from '@tanstack/react-query';
import type {
  PersistQueryClientOptions,
  PersistedClient,
  Persister,
} from '@tanstack/react-query-persist-client';
import { z } from 'zod';

import type { StorageAdapter } from '../repositories/storage-adapter';
import { CACHE_SCHEMA_VERSION } from './cache-schema-version';
import { LIBRARY_KEY_ROOT, SEARCH_KEY_ROOT } from './keys';
import { PERSISTED_CACHE_MAX_AGE } from './stale-times';

/** storage key of the persisted query cache. */
export const QUERY_CACHE_STORAGE_KEY = 'query-cache';

// every cache event asks for a save: write at most once per interval, with the latest state
export const PERSIST_THROTTLE_MS = 1000;

const QUERY_STATUS_PERSISTED = 'success';

type DehydratedQuery = DehydratedState['queries'][number];
type DehydratedMutation = DehydratedState['mutations'][number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// stored content is untrusted: check the envelope the restore relies on, hydrate reads the rest
const persistedClientSchema = z.object({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.object({
    queries: z.array(z.custom<DehydratedQuery>(isRecord)),
    mutations: z.array(z.custom<DehydratedMutation>(isRecord)),
  }),
});

// placeholder before the first save; never written, a save always replaces it first
const EMPTY_CLIENT: PersistedClient = {
  timestamp: 0,
  buster: '',
  clientState: { queries: [], mutations: [] },
};

const parsePersistedClient = (stored: string): PersistedClient | undefined => {
  try {
    const result = persistedClientSchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : undefined;
  } catch {
    // invalid json: handled like a wrong envelope by the caller
    return undefined;
  }
};

/**
 * persists the query cache to the synchronous `StorageAdapter` (MMKV on mobile).
 * the persisted cache never holds secrets: the auth session lives in `SessionStorage` (ADR-0005).
 * a malformed stored cache is removed and restores as empty instead of throwing.
 */
export const createQueryPersister = (storage: StorageAdapter): Persister => {
  let latest: PersistedClient = EMPTY_CLIENT;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const removeClient = (): void => {
    // a save still waiting would write the removed cache back
    clearTimeout(timer);
    timer = undefined;
    storage.delete(QUERY_CACHE_STORAGE_KEY);
  };

  return {
    persistClient: (client) => {
      latest = client;
      timer ??= setTimeout(() => {
        timer = undefined;
        storage.set(QUERY_CACHE_STORAGE_KEY, JSON.stringify(latest));
      }, PERSIST_THROTTLE_MS);
    },
    restoreClient: () => {
      const stored = storage.getString(QUERY_CACHE_STORAGE_KEY);
      if (stored === undefined) {
        return undefined;
      }
      const client = parsePersistedClient(stored);
      if (client === undefined) {
        // a corrupted cache only means a cold start: drop it so the next restore starts clean
        removeClient();
      }
      return client;
    },
    removeClient,
  };
};

interface PersistOptionsInput {
  persister: Persister;
  appVersion: string;
  // overridable for tests only; the app uses CACHE_SCHEMA_VERSION
  cacheSchemaVersion?: number;
}

// keys starting with one of these roots are never persisted
const NOT_PERSISTED_KEY_ROOTS: ReadonlySet<unknown> = new Set([SEARCH_KEY_ROOT, LIBRARY_KEY_ROOT]);

// only successful queries are kept, except:
// - searches: every debounced prefix of a typed search would be stored for days and rewritten on
//   each save, and search text stays off the stored cache
// - the library: the repository is the source of truth (the guest store is already on the
//   device); the throttled copy can lag it, and an action fired before the restored entry
//   refetches would write over newer data; a restored entry skips its schema; and notes would be
//   duplicated in the stored cache
const shouldDehydrateQuery = (query: {
  readonly queryKey: readonly unknown[];
  readonly state: { readonly status: string };
}): boolean =>
  query.state.status === QUERY_STATUS_PERSISTED && !NOT_PERSISTED_KEY_ROOTS.has(query.queryKey[0]);

// mutations are never persisted: auth mutation variables hold passwords, and tanstack would
// otherwise store a paused mutation, variables included, once onlineManager follows the device
// connectivity (docs/ARCHITECTURE.md §8)
const shouldDehydrateMutation = (): boolean => false;

/**
 * persistence options: a new app version or cache schema version drops the cache,
 * only successful queries are kept, never a search nor a library query, never a mutation.
 */
export const createPersistOptions = ({
  persister,
  appVersion,
  cacheSchemaVersion = CACHE_SCHEMA_VERSION,
}: PersistOptionsInput): Omit<PersistQueryClientOptions, 'queryClient'> => ({
  persister,
  maxAge: PERSISTED_CACHE_MAX_AGE,
  buster: `${appVersion}+${String(cacheSchemaVersion)}`,
  dehydrateOptions: {
    shouldDehydrateQuery,
    shouldDehydrateMutation,
  },
});
