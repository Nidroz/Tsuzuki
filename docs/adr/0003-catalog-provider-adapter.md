# ADR-0003: Catalog data behind a CatalogProvider adapter

- Status: Accepted
- Date: 2026-09-23

## Context

Jikan is an unofficial MyAnimeList API: free and complete, but rate-limited (~3 req/s, ~60 req/min) and dependent on MyAnimeList availability. Alternatives exist (AniList, MangaUpdates, MAL official API) with different strengths.

## Decision

All catalog access goes through a `CatalogProvider` interface in `src/core/catalog/`, returning normalized types. Jikan is the first adapter. The canonical media identifier is the MyAnimeList id, which Jikan uses natively and AniList exposes (`idMal`). Every adapter parses raw responses with Zod and uses the shared rate limiter.

## Consequences

- Swapping or adding a provider only requires a new adapter plus its fixtures and contract tests.
- Provider-specific fields never reach features or UI.
- The normalized model is the lowest common denominator; provider-specific extras need an explicit extension of the interface.
