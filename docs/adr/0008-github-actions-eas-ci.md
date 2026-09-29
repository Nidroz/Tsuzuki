# ADR-0008: GitHub, GitHub Actions and EAS for CI/CD

- Status: Accepted
- Date: 2026-09-23
- Amended: 2026-09-29. The owner keeps a single author, so no bot opens pull requests: dependency updates became a recurring maintenance chore done under the owner's identity, with Dependabot alerts only.

## Context

We need versioning, strict quality gates and automated builds/releases for both stores, integrated with Expo and Supabase.

## Decision

- GitHub hosts the repository. Two long-lived protected branches: `dev` (development/integration, deployed to staging) and `main` (production, GitHub default branch). Since `main` is the default, PRs set their base explicitly (`--base dev`), and issues referenced with `Closes #n` close when the change reaches `main`. PR only, required status checks listed in `ARCHITECTURE.md` §10. Feature branches target `dev`; releases go from `dev` to `main` through a release PR; hotfixes branch from `main` and are merged back into `dev`.
- GitHub Actions runs quality gates on every PR and deploys migrations (staging on merge to `dev`, production on release tag from `main`).
- EAS Build / Submit / Update handles native builds, store submission and OTA updates.
- release-please generates versions and changelog from conventional commits.
- Dependency updates are a recurring maintenance chore done under the owner's identity (single author); Dependabot alerts only, no update bot. gitleaks, `pnpm audit` and CodeQL cover security.
- The repository has a single contributor (the owner); a `commit-msg` hook rejects co-author trailers.

## Consequences

- Best ecosystem fit (Expo and Supabase integrations).
- iOS builds run on EAS, so no macOS GitHub runners are needed.
- GitHub Actions minutes and EAS build quotas must be monitored.
- Dependencies stay current only if the recurring update is actually run; Dependabot alerts and `pnpm audit` flag vulnerable versions in between.
