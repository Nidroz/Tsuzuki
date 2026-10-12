# src/core/catalog

The `CatalogProvider` interface with its normalized types, the shared rate limiter, and one subfolder per provider (`jikan/` is added in C-03).
Adapters parse every response with Zod, set `isAdult`, go through the rate limiter and never filter content in requests (ADR-0004); Jikan is imported only in its adapter.
`catalog-provider.ts` holds the interface and normalized types (no Zod); `search-params.ts` normalizes `SearchParams` for the search query key.
`src/core/` never imports React Native, Expo modules or NativeWind.
