# src/core/query

TanStack Query client, the query key factory (`keys.ts`) and stale times as defined in `docs/ARCHITECTURE.md` §6.
Query keys are built only through the factory, never inline.
`src/core/` never imports React Native, Expo modules or NativeWind.
