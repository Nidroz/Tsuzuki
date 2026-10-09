# src/core/query

TanStack Query setup, as defined in `docs/ARCHITECTURE.md` §6:

- `keys.ts`: the query key factory; query keys are built only through it, never inline.
- `stale-times.ts`: stale time per query family and the persisted cache max age.
- `query-client.ts`: `createQueryClient()`, a new client per call (no retries: the rate limiter owns them).
- `persister.ts`: the query cache persister over `StorageAdapter`, busted by app version; only successful queries are persisted, never secrets.

`src/core/` never imports React Native, Expo modules or NativeWind.
