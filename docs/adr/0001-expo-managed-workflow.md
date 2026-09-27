# ADR-0001: Expo managed workflow with Expo Router

- Status: Accepted
- Date: 2026-09-23

## Context

Tsuzuki targets Android and iOS stores and is built by a single developer. Maintenance cost and iOS builds without a Mac matter more than low-level native control.

## Decision

Use Expo (managed workflow, latest stable SDK) with Expo Router for file-based navigation, and EAS Build / Submit / Update for builds, store submission and over-the-air updates. Native code is added only through Expo config plugins, never by ejecting.

## Consequences

- No native projects to maintain; SDK upgrades follow Expo's guided path.
- iOS builds run on EAS, no Mac required.
- JS-only fixes can ship via EAS Update.
- A library without Expo support requires a config plugin or an alternative; this is checked before adding any native dependency.
