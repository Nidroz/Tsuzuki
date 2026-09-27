# ADR-0004: Adult content filtered client-side, never in requests

- Status: Accepted
- Date: 2026-09-23

## Context

The catalog contains adult titles (Hentai, Erotica genres, Rx rating). App store policies require such content to be hidden by default. Providers offer request-level filters (e.g. Jikan `sfw`), but using them would mean separate caches and refetches per setting, and different results depending on the provider.

## Decision

Providers are always queried without content filters. Adapters compute an `isAdult` flag. A pure domain function hides adult items when the user setting `showAdult` is off (default). The filter is applied on cached data (TanStack Query `select`).

## Consequences

- Toggling the setting is instant and never refetches.
- One cache per query regardless of the setting.
- Filtered pages may show fewer items than the provider page size; the UI indicates it.
- Adult items' metadata is fetched and cached, but their covers and details are never rendered while the filter is on.
- Store listing uses a 17+ / 18 age rating; iOS exposure of the toggle is checked against the App Store Review Guidelines before release.
