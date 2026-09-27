# ADR-0006: Layered architecture with a platform-agnostic core

- Status: Accepted
- Date: 2026-09-23

## Context

A web version in Next.js is planned later, and a dedicated backend may replace or complement Supabase. Both must be possible without rewriting business logic.

## Decision

Four layers with enforced import rules (`import/no-restricted-paths`):

- `src/core/`: domain rules, schemas, catalog providers, repositories, hooks, i18n. May use React and TanStack Query, never React Native, Expo modules or NativeWind.
- `src/platform/`: mobile-only adapters (MMKV storage, secure session storage, Sentry) implementing interfaces defined in core.
- `src/ui/`: design system.
- `src/features/` + `app/`: mobile screens.

Screens depend on hooks; hooks depend on repository and provider interfaces.

## Consequences

- When the web app starts, the repo becomes a pnpm + Turborepo monorepo and `src/core/` moves to `packages/core` unchanged; the web app writes its own screens and platform adapters.
- A dedicated backend is a new repository implementation over HTTP.
- Slightly more indirection for a single app today; accepted for maintainability.
