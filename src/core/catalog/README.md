# src/core/catalog

The `CatalogProvider` interface with its normalized types, the shared http layer, and one subfolder per provider (`jikan/` holds the Jikan rate limit policy; its adapter is added in C-03).
Adapters parse every response with Zod, set `isAdult`, go through the rate limiter and never filter content in requests (ADR-0004); Jikan is imported only in its adapter.
`catalog-provider.ts` holds the interface and normalized types (no Zod); `search-params.ts` normalizes `SearchParams` for the search query key.
`http/` is the http client every adapter sends its requests through (`createCatalogHttpClient`, one per provider instance): a token bucket rate limiter (`rate-limiter.ts`), in-flight dedup of identical urls (`in-flight-dedup.ts`), retries with exponential backoff and jitter on 429, 5xx, network errors and timeouts, honoring Retry-After (`retry-policy.ts`), and abort helpers (`abortable.ts`). Its errors live in `src/core/errors/catalog-errors.ts`.
`src/core/` never imports React Native, Expo modules or NativeWind.
