# ADR-0002: Supabase as backend

- Status: Accepted
- Date: 2026-09-23

## Context

We need accounts, multi-device sync and server-side security without running and maintaining a custom server. Candidates: Supabase, Firebase.

## Decision

Use Supabase: Auth (email, Google, Apple), Postgres with Row Level Security, Edge Functions for privileged operations (account deletion). Schema changes are SQL migrations versioned in `supabase/migrations/`. Two hosted projects: staging and production.

## Consequences

- Relational model fits libraries and future statistics; SQL constraints enforce business rules server-side.
- Security is declared in RLS policies and tested with pgTAP in CI.
- Clients depend on Supabase only through repository interfaces (ADR-0006), so a dedicated backend can be introduced later without touching screens.
- Free tier limits (project pausing, quotas) must be monitored before launch.
