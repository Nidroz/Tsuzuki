# Backlog

One item = one branch = one PR. Items are taken in order unless the owner says otherwise. Tick `[x]` only when the Definition of Done (`CONTRIBUTING.md` §8) is met.

## Phase 0 — Setup (owner)

- [x] Create the GitHub repository `tsuzuki` (private) with `main` (default branch, production) and `dev` (development), both protected (PR only, no force push; required checks added after F-04)
- [ ] Create Supabase projects `tsuzuki-staging` and `tsuzuki-prod`
- [ ] Create the Expo account/project and link EAS
- [ ] Sentry project
- [ ] Later, before release: Apple Developer and Google Play Console accounts

## Phase 1 — Foundations

- [x] F-01 Initialize the Expo project
- [x] F-02 Linting, formatting and git hooks
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
- `.gitattributes` with `* text=auto eol=lf`.
- Node pinned: `.nvmrc` = 22, `engines.node` >= 22, `packageManager` field for pnpm (Corepack).
- husky with a `commit-msg` hook rejecting any `Co-authored-by` trailer or tool-generated footer (the rest of the git hooks come in F-02).
- `pnpm check` = `pnpm typecheck` (lint and tests are added by F-02 and F-03).
- **Acceptance**: app starts in Expo Go (or an Android emulator); `pnpm check` passes; a commit with a `Co-authored-by` trailer is rejected.

### F-02 Linting, formatting and git hooks
- ESLint 10 (typescript-eslint strict type-checked, @eslint-react, react-hooks, import-x) + Prettier; eslint-plugin-react-native dropped (incompatible with ESLint 10).
- `import-x/no-restricted-paths` encoding the layer rules of `CONTRIBUTING.md` §4, plus `no-restricted-imports` banning `react-native`, `expo-*` and `nativewind` in `src/core/`.
- lint-staged (pre-commit) and commitlint (conventional commits) on the husky setup from F-01.
- `pnpm check` extended with `pnpm lint` and `pnpm format:check`.
- **Acceptance**: a deliberate layer violation is rejected (proved in the PR description); `pnpm lint` passes with zero warnings.

### F-03 Test tooling
- Jest (jest-expo preset), React Native Testing Library, MSW for HTTP mocking, fake timers setup.
- Coverage thresholds: `src/core/` 90 % lines/branches, global 70 % lines; CI fails below.
- pgTAP runner: `pnpm test:rls` runs `supabase test db`.
- Maestro installed and one smoke flow (app launches; the tabs check is added in F-07).
- `pnpm check` extended with `pnpm test`.
- Unit tests for the single-author commitlint rule (`singleAuthorViolation` / `singleAuthor` exports): LF and CRLF, lowercase and indented trailers, generated with/by footers, comment lines, scissors section, merge/revert/fixup exemption.
- Regression tests for the layer lint rules via the ESLint Node API: one case per zone, package ban, type-only rule, canonical path rule, network ban and Jikan guard, plus positive controls.
- Last: a small local ESLint plugin enforcing `TODO(<backlog id>)` (checking, if feasible, that the ID exists in `docs/BACKLOG.md`) and file name casing (kebab-case, PascalCase components, expo-router names such as `_layout`, `[id]`, `(tabs)`, `+not-found`), tested with `RuleTester`.
- **Acceptance**: sample tests in each category pass; lowering coverage makes `pnpm test` fail.

### F-04 CI pipeline
- `.github/workflows/ci.yml` on PR: install (cached), lint, typecheck, test + coverage, RLS tests (Supabase CLI in CI), gitleaks, `pnpm audit --audit-level high`.
- CodeQL workflow. Renovate config (grouped, weekly, automerge off, `baseBranches: ["dev"]`); hold `test-renderer` below 1.3 until the Expo SDK ships React 19.3 or later (1.3 requires it), and keep `jest`, `@jest/globals` and `jest-expo` on the major the Expo SDK supports.
- CI also runs `pnpm test:tooling` (part of `pnpm check`) and `pnpm test:rls` with the Supabase CLI from the pinned dev dependency (`pnpm exec supabase start`, then `pnpm test:rls`).
- Workflow check failing any PR from a work branch (`feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`) that targets `main`.
- Commit message check on every commit of the PR: commitlint plus the same co-author trailer / generated footer rule as the `commit-msg` hook, so commits made with `--no-verify` are still caught (`commitlint --from <base> --to <head>`, checkout with `fetch-depth: 0`, same `commitlint.config.mjs`).
- commitlint on the PR title: squash merges use it as the commit message and release-please depends on it.
- release-please config.
- CI runs on PRs to both `dev` and `main`; release PRs to `main` also run the E2E suite.
- Document required checks to enable in branch protection for `dev` and `main`.
- **Acceptance**: a PR with a failing test, a lint warning, a fake secret or a commit message with a co-author trailer is blocked.

### F-05 Theme and UI primitives
- NativeWind setup confined to `src/ui/`.
- Tokens in `src/ui/theme/` (colors light/dark, spacing, radii, typography), system/light/dark switching.
- Primitives: `Screen`, `Text`, `Button`, `IconButton`, `Card`, `Input`, `Chip`, `Spinner`, `EmptyState`, `ErrorState`, `Pagination` (numbers window, prev/next, jump to page).
- When extending the lint layer rules, split `eslint.config.mjs`: the layer tables move to their own module in `tools/eslint/`.
- Add a lint zone preventing production code (`app/`, `src/`) from importing the test infrastructure in `test/`.
- Close the layer rule gaps found by the F-03 regression tests: files directly under `src/` outside the four layers get no layer rules, `EventSource` is not in the banned network globals, and `jest.mock(...)` / `jest.requireActual(...)` specifiers are not checked by the package bans; add a regression case for each.
- Decide how `tsuzuki/file-name-case` treats dotfiles and dot-folders (e.g. `.prettierrc.mjs`, `.storybook/`, rejected today) and Expo API route files (`+api`), before the first one is added.
- **Acceptance**: every primitive has component tests incl. accessibility labels; no `className` outside `src/ui/` (lint rule or check script).

### F-06 Internationalization
- i18n in `src/core/i18n/` with `en.json` and `fr.json`, device locale detection via platform adapter, EN fallback, setting override.
- Formatting (dates, numbers) always passes an explicit locale, so tests do not depend on the machine locale.
- **Acceptance**: switching language in settings updates the UI; a missing key fails a test.

### F-07 Navigation shell
- Tabs: Discover, Search, Library, Favorites, Settings, with placeholder screens using primitives.
- Media detail route `media/[kind]/[id]` with Zod-validated params.
- Settings: theme and language pickers wired.
- Maestro smoke flow from F-03 extended: the five tabs are visible.
- **Acceptance**: navigation E2E smoke flow passes, including the tabs check; invalid deep link params show an error state.

### F-08 Supabase schema v1
- Tune the local Supabase config created in F-03 (auth, email confirmation, redirect URLs, seed), first migration from `ARCHITECTURE.md` §5: enums, `profiles`, `library_entries`, `progress_events`, `updated_at` trigger, progress event trigger, profile creation trigger on sign-up, indexes, RLS policies.
- pgTAP tests for every policy and constraint (BR-01, BR-07).
- Generated TypeScript DB types committed in `src/core/repositories/supabase/database.types.ts`.
- **Acceptance**: `pnpm test:rls` passes; another user cannot read or write an entry; anon has no access.

### F-09 Platform adapters and query client
- `StorageAdapter` interface in core, MMKV implementation in `src/platform/storage.ts`.
- Secure session storage adapter for supabase-js (`expo-secure-store`, chunking for large values).
- Supabase client factory in `src/core/repositories/supabase/` receiving the storage adapter.
- Query client with key factory, stale times, persisted cache (MMKV) busted on app version.
- Switch from Expo Go to a development build (`expo-dev-client`), required by MMKV; the Maestro smoke flow targets the development build app id instead of Expo Go.
- With the first core hook (here or in C-04): add `@testing-library/react` and a jsdom test environment for core hook tests (`@testing-library/react-native` is banned in `src/core/`).
- **Acceptance**: unit tests for adapters and key factory; session never written to MMKV (test); the app runs in a development build.

### F-10 Environments, Sentry and EAS
- `app.config.ts` reading env (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN`), validated with Zod at startup; `.env.example`.
- `eas.json` profiles: development, preview, production; channels matching `ARCHITECTURE.md` §10.
- Sentry with `beforeSend` PII scrubbing.
- ESLint `no-console` everywhere except the Sentry adapter.
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
