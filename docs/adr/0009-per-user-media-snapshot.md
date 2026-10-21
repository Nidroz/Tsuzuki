# ADR-0009: Media snapshot stored per user

- Status: Accepted
- Date: 2026-09-23

## Context

The library must render without calling the catalog provider (speed, rate limits, offline). A shared `media` table written by clients would let any user alter titles or image URLs displayed to everyone.

## Decision

Store the minimal media snapshot (title, image URL, format, total units, adult flag) in each user's `library_entries` row, covered by that user's RLS policy. The snapshot is refreshed when the user opens the media detail screen.

## Consequences

- No shared writable data: a user can only corrupt their own rows.
- Slight duplication across users, negligible at this scale.
- If a shared catalog cache is needed later, it will be written only by a trusted server component (Edge Function or backend), never by clients.

## Update (2026-10-21)

The decision stands: the snapshot lives in each user's own rows, under that user's RLS, and nothing writable is shared. These implementation details changed:

- **Row identity** (ADR-0013, migration `supabase/migrations/20261014135948_media_id_namespace.sql`): a snapshot belongs to the row keyed by `(user_id, id_namespace, media_kind, external_id)` instead of `mal_id`. Switching catalog instance (Tenrai, a self-hosted Jikan) keeps every row and its snapshot, because both serve the same `mal` namespace.
- **When the snapshot is refreshed** (L-03): opening the detail screen shows the entry with the catalog's fresh snapshot but writes nothing. The fresh snapshot is persisted with the next library action the user takes on that screen. A refresh on view alone would be a write triggered by opening a deep link, which CONTRIBUTING.md §7 forbids. An entry that is viewed but never acted on keeps its stored snapshot. The library list never refreshes it (L-04).
- **Guest library** (L-02): a guest's entries keep the same snapshot on the device. It is validated against the same database limits, so the guest → account merge (A-04) cannot fail on it.
- **Stored cover URLs are untrusted** (L-04): a cover read back from storage is shown only through the provider's image hosts (`CatalogProvider.imageHosts`). An unknown host displays no image and leaves the entry intact.

See `docs/ARCHITECTURE.md` §2 "Deep links and route params", §5 and §6 "Library".
