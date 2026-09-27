# ADR-0007: NativeWind isolated in the UI layer

- Status: Accepted
- Date: 2026-09-23

## Context

We want fast styling with light/dark themes, while keeping the option to switch styling library or apply an external design template later.

## Decision

Use NativeWind, but only inside `src/ui/`. Design tokens (colors, spacing, radii, typography) are defined once in `src/ui/theme/`. Features and screens compose `src/ui/components/` primitives and never use `className` or style libraries directly.

## Consequences

- Changing the styling library or applying a template means rewriting `src/ui/` only.
- New visual needs require adding or extending a primitive rather than styling inline in a screen.
