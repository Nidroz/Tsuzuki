# src/core/query

TanStack Query setup, as defined in `docs/ARCHITECTURE.md` §6:

- `keys.ts`: the query key factory; query keys are built only through it, never inline. Media and catalog keys hold the media id namespace (`mal`), never a server or instance id, so switching the catalog instance keeps the cache.
- `stale-times.ts`: stale time per query family and the persisted cache max age.
- `query-client.ts`: `createQueryClient()`, a new client per call (no retries: the catalog http client in `src/core/catalog/http/` owns them).
- `persister.ts`: the query cache persister over `StorageAdapter`, busted by app version; only successful queries are persisted, never secrets.

`src/core/` never imports React Native, Expo modules or NativeWind.
