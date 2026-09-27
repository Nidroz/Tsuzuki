# Backlog

One item = one branch = one PR. Items are taken in order unless the owner says otherwise. Tick `[x]` only when the Definition of Done (`CONTRIBUTING.md` §8) is met.

## Phase 0 — Setup (owner)

- [ ] Create the GitHub repository `tsuzuki` (private) with `main` (default branch, production) and `dev` (development), both protected (PR only, no force push; required checks added after F-04)
- [ ] Create Supabase projects `tsuzuki-staging` and `tsuzuki-prod`
- [ ] Create the Expo account/project and link EAS
- [ ] Sentry project
- [ ] Later, before release: Apple Developer and Google Play Console accounts

## Phase 1 — Foundations

- [ ] F-01 Initialize the Expo project
- [ ] F-02 Linting, formatting and git hooks
- [ ] F-03 Test tooling
- [ ] F-04 CI pipeline
- [ ] F-05 Theme and UI primitives
- [ ] F-06 Internationalization
- [ ] F-07 Navigation shell
- [ ] F-08 Supabase schema v1
- [ ] F-09 Platform adapters and query client
- [ ] F-10 Environments, Sentry and EAS

Details:

### F-01 Initialize the Expo project
- Expo (latest stable SDK) + Expo Router + TypeScript, pnpm, Hermes.
- `tsconfig` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; path aliases `@core/*`, `@features/*`, `@ui/*`, `@platform/*`.
- Folder structure from `ARCHITECTURE.md` §2 (empty folders keep a `README.md` stating their purpose).
- **Acceptance**: app starts on Android emulator and iOS simulator (or Expo Go); `pnpm typecheck` passes.

### F-02 Linting, formatting and git hooks
- ESLint (typescript-eslint strict type-checked, react, react-hooks, react-native, import) + Prettier.
- `import/no-restricted-paths` encoding the layer rules of `CONTRIBUTING.md` §4, plus `no-restricted-imports` banning `react-native`, `expo-*` and `nativewind` in `src/core/`.
- husky + lint-staged (pre-commit), commitlint (conventional commits).
- `commit-msg` hook rejecting any `Co-authored-by` trailer or tool-generated footer (single author).
- **Acceptance**: a deliberate layer violation and a commit with a `Co-authored-by` trailer are both rejected (proved in the PR description); `pnpm lint` passes with zero warnings.

### F-03 Test tooling
- Jest (jest-expo preset), React Native Testing Library, MSW for HTTP mocking, fake timers setup.
- Coverage thresholds: `src/core/` 90 % lines/branches, global 70 % lines; CI fails below.
- pgTAP runner: `pnpm test:rls` runs `supabase test db`.
- Maestro installed and one smoke flow (app launches, tabs visible).
- **Acceptance**: sample tests in each category pass; lowering coverage makes `pnpm test` fail.

### F-04 CI pipeline
- `.github/workflows/ci.yml` on PR: install (cached), lint, typecheck, test + coverage, RLS tests (Supabase CLI in CI), gitleaks, `pnpm audit --audit-level high`.
- CodeQL workflow. Renovate config (grouped, weekly, automerge off, `baseBranches: ["dev"]`).
- Workflow check failing any PR from a work branch (`feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`) that targets `main`.
- release-please config.
- CI runs on PRs to both `dev` and `main`; release PRs to `main` also run the E2E suite.
- Document required checks to enable in branch protection for `dev` and `main`.
- **Acceptance**: a PR with a failing test, a lint warning or a fake secret is blocked.

### F-05 Theme and UI primitives
- NativeWind setup confined to `src/ui/`.
- Tokens in `src/ui/theme/` (colors light/dark, spacing, radii, typography), system/light/dark switching.
- Primitives: `Screen`, `Text`, `Button`, `IconButton`, `Card`, `Input`, `Chip`, `Spinner`, `EmptyState`, `ErrorState`, `Pagination` (numbers window, prev/next, jump to page).
- **Acceptance**: every primitive has component tests incl. accessibility labels; no `className` outside `src/ui/` (lint rule or check script).

### F-06 Internationalization
- i18n in `src/core/i18n/` with `en.json` and `fr.json`, device locale detection via platform adapter, EN fallback, setting override.
- **Acceptance**: switching language in settings updates the UI; a missing key fails a test.

### F-07 Navigation shell
- Tabs: Discover, Search, Library, Favorites, Settings, with placeholder screens using primitives.
- Media detail route `media/[kind]/[id]` with Zod-validated params.
- Settings: theme and language pickers wired.
- **Acceptance**: navigation E2E smoke flow passes; invalid deep link params show an error state.

### F-08 Supabase schema v1
- Local Supabase config, first migration from `ARCHITECTURE.md` §5: enums, `profiles`, `library_entries`, `progress_events`, `updated_at` trigger, progress event trigger, profile creation trigger on sign-up, indexes, RLS policies.
- pgTAP tests for every policy and constraint (BR-01, BR-07).
- Generated TypeScript DB types committed in `src/core/repositories/supabase/database.types.ts`.
- **Acceptance**: `pnpm test:rls` passes; another user cannot read or write an entry; anon has no access.

### F-09 Platform adapters and query client
- `StorageAdapter` interface in core, MMKV implementation in `src/platform/storage.ts`.
- Secure session storage adapter for supabase-js (`expo-secure-store`, chunking for large values).
- Supabase client factory in `src/core/repositories/supabase/` receiving the storage adapter.
- Query client with key factory, stale times, persisted cache (MMKV) busted on app version.
- **Acceptance**: unit tests for adapters and key factory; session never written to MMKV (test).

### F-10 Environments, Sentry and EAS
- `app.config.ts` reading env (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN`), validated with Zod at startup; `.env.example`.
- `eas.json` profiles: development, preview, production; channels matching `ARCHITECTURE.md` §10.
- Sentry with `beforeSend` PII scrubbing.
- Workflows: EAS preview build + staging migrations on merge to `dev`; production build, prod migrations and store submission on release tag from `main`; back-merge `main` → `dev` after each release.
- **Acceptance**: preview build installs on a device; a test proves PII scrubbing.

## Phase 2 — Catalog

- [ ] C-01 `CatalogProvider` interface + normalized types + content filter domain function
- [ ] C-02 Rate limiter (token bucket, dedup, backoff) 
- [ ] C-03 Jikan adapter: search, detail, top, season, genres, with Zod schemas and recorded fixtures
- [ ] C-04 Search screen: debounced bar, recent searches, results list
- [ ] C-05 Filters sheet: kind, format, genres in/out, status, year, min score, sort
- [ ] C-06 Interactive pagination with prefetch and position restore
- [ ] C-07 Media detail screen
- [ ] C-08 Discovery screen: top anime, top manga (format chips), current season

## Phase 3 — Library (guest first)

- [ ] L-01 Library domain rules BR-01 to BR-05, BR-09 as pure functions
- [ ] L-02 Local (guest) library repository
- [ ] L-03 Add/remove, status, progress `+1` (optimistic + coalesced), score, notes
- [ ] L-04 Library screen: grouping, filters, sorting
- [ ] L-05 Favorites (toggle + tab)
- [ ] L-06 Adult content setting wired to the filter

## Phase 4 — Accounts and sync

- [ ] A-01 Email auth (sign up with confirmation, sign in, reset password)
- [ ] A-02 Google and Apple sign-in (PKCE)
- [ ] A-03 Supabase library repository + repository switch on auth state
- [ ] A-04 Guest → account merge (BR-08)
- [ ] A-05 Offline write queue and replay
- [ ] A-06 Sign out purge; `delete-account` Edge Function + in-app flow

## Phase 5 — Release

- [ ] R-01 E2E suite complete (critical flows)
- [ ] R-02 Performance pass (cold start, list FPS, bundle size)
- [ ] R-03 Accessibility pass
- [ ] R-04 MASVS L1 security review
- [ ] R-05 Privacy policy, store listings, screenshots, age rating
- [ ] R-06 Internal testing: TestFlight + Play internal track
