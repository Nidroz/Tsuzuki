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
