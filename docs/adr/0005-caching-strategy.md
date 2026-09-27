# ADR-0005: TanStack Query with a persisted MMKV cache

- Status: Accepted
- Date: 2026-09-23

## Context

The catalog provider is rate-limited and the app must feel instant, including offline for the library and already viewed titles.

## Decision

- TanStack Query manages all server state, with stale times per data type (detail 24 h, top/season 6 h, search 10 min, genres 7 days, library always revalidated).
- The query cache is persisted to MMKV and busted on app version change.
- A shared token-bucket rate limiter with request dedup and exponential backoff wraps every provider call.
- Pagination keeps the previous page as placeholder and prefetches the next one.
- User writes are optimistic, coalesced, and queued offline.

## Consequences

- Fast cold starts and offline reading.
- Cache keys are centralized in one factory to avoid invalidation bugs.
- Persisted data must never include secrets (the session lives in secure-store, see `ARCHITECTURE.md` §8).
