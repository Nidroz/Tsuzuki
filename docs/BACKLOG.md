# Backlog

One item = one branch = one PR. Items are taken in order unless the owner says otherwise. Tick `[x]` only when the Definition of Done (`CONTRIBUTING.md` §8) is met.

## Phase 0 — Setup (owner)

- [x] Create the GitHub repository `tsuzuki` (public) with `main` (default branch, production) and `dev` (development), both protected (PR only, no force push; required checks added after F-04)
- [ ] Create Supabase projects `tsuzuki-staging` and `tsuzuki-prod`
- [ ] Create the Expo account/project and link EAS
- [ ] Sentry project
- [ ] Later, before release: Apple Developer and Google Play Console accounts

## Phase 1 — Foundations

- [x] F-01 Initialize the Expo project
- [x] F-02 Linting, formatting and git hooks
- [x] F-03 Test tooling
- [x] F-04 CI pipeline
- [x] F-05 Theme and UI primitives
- [x] F-06 Internationalization
- [x] F-07 Navigation shell
- [x] F-08 Supabase schema v1
- [x] F-09 Platform adapters and query client
- [x] F-10 Environments, Sentry and EAS
- [x] F-11 Release pipeline and error reporting hardening (F-10 review follow-ups)

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
- **Acceptance**: sample tests in each category pass; lowering coverage makes `pnpm test` fail. E2E: smoke flow written and reviewed, execution deferred to R-01.

### F-04 CI pipeline
- `.github/workflows/ci.yml` on PR: install (cached), lint, typecheck, test + coverage, RLS tests (Supabase CLI in CI), gitleaks, `pnpm audit --audit-level high`.
- CodeQL workflow. No dependency update bot: updates are the recurring item M-01, with Dependabot alerts only.
- CI also runs `pnpm test:tooling` (part of `pnpm check`) and `pnpm test:rls` with the Supabase CLI from the dev dependency locked by the lockfile (`pnpm exec supabase db start`, database only, then `pnpm test:rls`).
- Workflow check failing any PR from a work branch (`feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`) that targets `main`.
- Commit message check on every commit of the PR: commitlint plus the same co-author trailer / generated footer rule as the `commit-msg` hook, so commits made with `--no-verify` are still caught (`commitlint --from <base> --to <head>`, checkout with `fetch-depth: 0`, same `commitlint.config.mjs`).
- commitlint on the PR title: squash merges use it as the commit message and release-please depends on it.
- release-please config.
- CI runs on PRs to both `dev` and `main`. The E2E gate on release PRs moved to R-01.
- Document required checks to enable in branch protection for `dev` and `main`.
- **Acceptance**: a PR with a failing test, a lint warning, a fake secret or a commit message with a co-author trailer is blocked.

### F-05 Theme and UI primitives
- NativeWind setup confined to `src/ui/`.
- Tokens in `src/ui/theme/` (colors light/dark, spacing, radii, typography), system/light/dark switching.
- Primitives: `Screen`, `Text`, `Button`, `IconButton`, `Card`, `Input`, `Chip`, `Spinner`, `EmptyState`, `ErrorState`, `Pagination` (numbers window, prev/next, jump to page).
- When extending the lint layer rules, split `eslint.config.mjs`: the layer tables move to their own module in `tools/eslint/`.
- Add a lint zone preventing production code (`app/`, `src/`) from importing the test infrastructure in `test/`.
- Close the layer rule gaps found by the F-03 regression tests: files directly under `src/` outside the four layers get no layer rules, `EventSource` is not in the banned network globals, and `jest.mock(...)` / `jest.requireActual(...)` specifiers are not checked by the package bans; add a regression case for each.
- Tooling tests (low priority): detect computed forms like `t['skip']()`, stored references and `.only` on non-runner names in the test hygiene rules.
- Decide how `tsuzuki/file-name-case` treats dotfiles and dot-folders (e.g. `.prettierrc.mjs`, `.storybook/`, rejected today) and Expo API route files (`+api`), before the first one is added.
- **Acceptance**: every primitive has component tests incl. accessibility labels; no `className` outside `src/ui/` (lint rule or check script).

### F-06 Internationalization
- i18n in `src/core/i18n/` with `en.json` and `fr.json`, device locale detection via platform adapter, EN fallback, setting override.
- Formatting (dates, numbers) always passes an explicit locale, so tests do not depend on the machine locale.
- **Acceptance**: switching language in settings updates the UI; a missing key fails a test. Without a settings screen yet, the switch is proven by provider and route tests; the settings picker check moved to F-07.

### F-07 Navigation shell
- Tabs: Discover, Search, Library, Favorites, Settings, with placeholder screens using primitives.
- Media detail route `media/[kind]/[id]` with Zod-validated params.
- Settings: theme and language pickers wired.
- Navigation theme built from the `src/ui` palette, so navigator backgrounds follow dark mode (no light flash during transitions).
- Typed routes: decided off (`ARCHITECTURE.md` §2), so `tsconfig.json` keeps its `include` unchanged. Enabling them later means adding `.expo/types/**/*.ts` and `expo-env.d.ts` back to the `include` (removed in F-05 because `expo start` strips them while typed routes are off).
- Maestro smoke flow from F-03 extended: the five tabs are visible.
- Lint follow-ups from F-06: reject `.` and empty segments in aliased import paths (`@core/./i18n/x`, `@core//i18n/x` bypass the barrel rules today), and split `BANNED` / `CANONICAL_PATHS` out of `tools/eslint/layers.mjs` (at 300 lines).
- **Acceptance**: navigation E2E smoke flow written and reviewed, including the tabs check (execution deferred to R-01); invalid deep link params show an error state; switching the language in settings updates the UI (picker test, plus the owner's manual check on a device).

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
- Persist theme and language preferences with the storage adapter.
- **Acceptance**: unit tests for adapters and key factory; session never written to MMKV (test); the app runs in a development build.

### F-10 Environments, Sentry and EAS
- `app.config.ts` reading env (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN`), validated with Zod at startup; `.env.example`.
- `eas.json` profiles: development, preview, production; channels matching `ARCHITECTURE.md` §10.
- Sentry with `beforeSend` PII scrubbing.
- `expo-localization` config plugin with `supportedLocales` (`en`, `fr`), so the OS per-app language setting lists the app languages (deferred from F-06).
- ESLint `no-console` everywhere except the Sentry adapter.
- Workflows: EAS preview build + staging migrations on merge to `dev`; production build, prod migrations and store submission on release tag from `main`; back-merge `main` → `dev` after each release.
- Serialize reads and writes per key inside the chunked session storage (`src/platform/secure-session.ts`, F-09 review): overwriting a session is not atomic, and supabase-js takes no lock by default, so a read during an overwrite can see mixed chunks, find an invalid session and remove it (silent sign-out). Queue the calls per key, with a test of a read interleaved with an overwrite.
- Cache buster beyond the app version (F-09 review): an EAS update keeps the app version, so a restored query cache could hold data in an older shape. Build the buster from `APP_VERSION` plus a core `CACHE_SCHEMA_VERSION` (or the update id), with a test that changing it drops the cache.
- **Acceptance**: preview build installs on a device; a test proves PII scrubbing.

### F-11 Release pipeline and error reporting hardening (F-10 review follow-ups)
- `release.yml`: deploy to production only when the `v*` tag points to a commit on `main` (ancestor check of `origin/main`), and document a tag ruleset restricting who can create `v*` tags.
- EAS build quota: the preview build runs on every non-documentation push to `dev`. Add a path filter or batch the builds, and record the quota in ADR-0012.
- `tools/expo/resolve-ts-imports.cjs`: force the `module-typescript` format only for imports from the app config and its TypeScript imports, not for every `.ts` file resolved in the process; retry with `.ts` only on `ERR_MODULE_NOT_FOUND` and rethrow the original error when the retry fails.
- `src/platform/sentry-scrub.ts`: drop `request.env`; scrub free-text `notes=...`, single-quoted `{'notes': '...'}` and phone numbers, or record them as accepted limitations in `ARCHITECTURE.md` §9.
- OTA updates: off the EAS build worker, `app.config.ts` leaves `extra.env` out when no Supabase or Sentry value is set, so a local `eas update` or `expo export` without its EAS environment would publish an update that fails closed at startup. Require `--environment` for updates (script or workflow) and document it in `ARCHITECTURE.md` §10.
- `.gitleaksignore`: remove the four fingerprints of the F-10 branch commits, which are not in `dev` after the squash merge.
- `src/platform/secure-session.ts`: a write issues about 63 keychain deletes (95 with a legacy header). Delete only the previous generation's chunks, read from its header, and sweep every key only when the header was missing or invalid.

## Phase 2 — Catalog

- [x] C-01 `CatalogProvider` interface + normalized types + content filter domain function
- [x] C-02 Rate limiter (token bucket, dedup, backoff)
- [x] C-03 Jikan-compatible adapter (Tenrai by default): search, detail, top, season, genres, with Zod schemas and recorded fixtures
- [x] C-04 Search screen: debounced bar, recent searches, results list
- [x] C-05 Filters sheet: kind, format, genres in/out, status, year, min score, sort
- [x] C-06 Interactive pagination with prefetch and position restore
- [x] C-07 Media detail screen
- [ ] C-08 Discovery screen: top anime, top manga (format chips), current season

Details:

### C-03 Jikan-compatible adapter
- Reshaped by owner decisions after the public Jikan API (api.jikan.moe) shut down on 2026-10-01 (ADR-0013): one adapter for every Jikan v4 instance, with per-instance base URL and rate limits, Tenrai (`https://api.tenrai.org/v1`) by default and a self-hosted Jikan selected by one env value (`EXPO_PUBLIC_JIKAN_BASE_URL`); media identity is the id namespace (`mal`), not the server, in the domain types, the query keys, the detail route and `library_entries` (`id_namespace`, `external_id`); one shared contract suite for every `CatalogProvider` adapter; sustained provider failures reported through the `ErrorReporter`.
- Bump `CACHE_SCHEMA_VERSION` whenever a persisted normalized catalog shape changes after a release (C-01 review).
- Send every request through one `createCatalogHttpClient({ rateLimit: instance.rateLimit })` per provider instance (`getJson`), never a direct `fetch`; the adapter factory creates that client itself, the composition root never builds one (lint keeps `src/core/catalog/http/` out of `app/` and `src/features/`); build deterministic https URLs (stable parameter order, from `normalizeSearchParams` for search) so equivalent requests share one dedup key; pass the caller's `AbortSignal` through; map a Zod failure to `CatalogResponseError` (C-02).
- Monotonic clock for the rate limiter (owner decision, C-02 review): the limiter and the retry deadline read `Date.now`, clamped only when it jumps backwards; a forward wall-clock jump (NTP step, manual change) of 1.5 s or more refills the buckets at once (5 grants in one real second were measured with a +2 s jump), and 15 s or more releases the 10-token burst and shortens a running pause. Use `performance.now()` (Hermes, browsers, Node, Jest fake timers) for the limiter and the deadline, keep `Date.now` for `Retry-After` dates, drop `clampToClock`; or record the caveat in `ARCHITECTURE.md` §6.
- Release the body of a non-2xx response in `src/core/catalog/http/catalog-http-client.ts` (C-02 review): it is never read or cancelled, harmless on React Native (the XHR-based fetch buffers it) but it holds the connection on undici and browsers (future web app). Abort the attempt controller in the `finally`, or cancel `response.body` before throwing `CatalogHttpError`.
- Widen the lint zone of `src/core/catalog/http/` (C-02 review): only `app/` and `src/features/` are barred today, while `ARCHITECTURE.md` §2 says only provider adapters use the client; also target the rest of `src/core/` (`targetsExcept(CORE_ROOT, [...IMPLEMENTATION_FOLDERS, './src/core/catalog/http'])`) and `test/core/`, with cases in `tools/eslint/layers-cases.mjs`, or narrow the wording.
- Focused regression tests for interleavings so far covered only by fuzzing in the C-02 review: an abort landing after the dedup task settled but before the caller settles (`in-flight-dedup.test.ts`); the abort of a waiter in the middle of the limiter queue keeping FIFO order (`rate-limiter.test.ts`); a caller joining a url whose shared operation sleeps in backoff (`catalog-http-client-release.test.ts`).
- Recorded fixtures (done on Tenrai, 2026-10-14; api.jikan.moe had been unreachable since 2026-10-13, then shut down): record the real v4 responses with about 13 sequential plain GETs, one per 1.5 s, raw output kept outside the repository: `/anime?q=frieren&limit=5`, `/manga?q=solo%20leveling&type=manhwa&limit=5`, the empty search `/anime?q=zzqxjvwkpt&limit=5`, the details `/anime/52991`, `/manga/121496` and `/manga/2`, `/top/anime?page=1&limit=5`, `/top/manga?page=1&limit=5`, `/seasons/now?page=1&limit=15`, `/genres/anime`, `/genres/manga`, and the year probe `/anime?q=one%20piece&start_date=1999-01-01&end_date=1999-12-31&limit=5` (a title that started in 1999 and is still airing: listed means `end_date` does not drop titles still airing and `jikanYearRange` stays; missing means it bounds the end of airing, and the year filter meaning is decided before C-05 exposes it). Trim them into `src/core/catalog/jikan/__fixtures__/tenrai/*.json` (at most 3 items, synopsis and background replaced by placeholders, no adult titles or covers, no people or organizations, one item with a null score, count or year if the responses hold one), add a test running them through the provider, and verify against them: the case of the anime search `type` values, the `titles[].type` values, whether an anime `status` can be null, and that every item of search, top, season and detail carries the four genre arrays (`genres`, `explicit_genres`, `themes`, `demographics`) and, for anime, the `rating` key. These inputs fail a whole response today: a mismatch is fixed in the same step (schema, tests, `ARCHITECTURE.md` §3), never by relaxing BR-06. Result: every listed fact holds on Tenrai, and the year probe shows that `end_date` bounds the end of airing (One Piece, airing since 1999, is missing with `end_date=1999-12-31` and listed without it), so the year filter meaning moves to C-05.

### C-04 Search screen
- Wire the catalog provider in the composition root (`app/_layout.tsx`) together with the first catalog hook, through a React context in `src/core/hooks/` that provides the `CatalogProvider`: the hooks depend on the interface only, never on the Jikan implementation (C-03). Provider selection happens only there (ADR-0013): `monitorCatalogProvider(createJikanCatalogProvider(jikanInstanceFor(appEnv.jikanBaseUrl)), { reporter })`, so an unset `EXPO_PUBLIC_JIKAN_BASE_URL` selects Tenrai and sustained failures reach the `ErrorReporter`.
- Cap the search input at the adapter's query limit (300 UTF-16 code units, Tenrai's documented `q` limit; longer text is a `RangeError` before any request, C-03). Features cannot import the adapter: expose the limit through a core constant or the provider.

### C-05 Filters sheet
- `MEDIA_FORMATS_BY_KIND` includes the `unknown` fallback: leave it out of the format chips, or add a searchable formats list in `src/core/domain/media.ts` (C-01 review).
- `SearchParams.formats` accepts any `MediaFormat` for either kind (`{ kind: 'manga', formats: ['tv'] }` typechecks): validate formats per kind, or make `SearchParams` a union keyed on `kind` (C-01 review).
- The Jikan adapter accepts one format per search and has no search type for `oel` or `unknown` (a `RangeError` before any request, C-03): make the format chips single-select and leave these two out, or change `SearchParams`.
- Hide the adult genre chips (names in `ADULT_GENRE_NAMES`, `src/core/domain/content-filter.ts`) when the adult content setting is off (BR-06).
- Decide the year filter meaning before exposing it (C-03, confirmed on Tenrai): `start_date` bounds the start of airing and `end_date` its end, so `jikanYearRange` (`src/core/catalog/jikan/jikan-urls.ts`, year Y → `start_date=Y-01-01&end_date=Y-12-31`) matches only titles aired entirely within Y and drops titles still airing or spanning two years. Choose "started in Y" (for example `start_date` alone with a start-date sort and a cut at the first later year), "from Y onwards", or drop the filter, and adjust `jikanYearRange` and `ARCHITECTURE.md` §3.
- The genre chips select at most 25 included and 25 excluded genres (Tenrai's documented limit; more is a `RangeError` before any request, C-03).

### C-06 Interactive pagination
- Lock the search placeholder behaviour before changing it for pages (C-04 review): `src/core/hooks/use-search.test.tsx` has no case for search A, then B still loading, then C (C keeps A's results only because TanStack reuses the previous placeholder while the `placeholderData` function stays the same object), and no `SearchScreen` test types a search, clears the field and types another one to check the spinner replaces the old results.
- Prefetches share the FIFO queue of the catalog rate limiter with the requests of the visible screen (C-02): give visible requests priority, or skip a prefetch while requests are queued, so a prefetch never delays the page the user opens.
- When touching the catalog http tests: `settle`, `recordRequests`, `expectNoPendingTimer` and `elapsed` are copied in four test files of `src/core/catalog/http/` (C-03 review); move them into one shared test helper, under a name that the coverage exclusions and the test lint overrides treat as test code.

### C-07 Media detail screen
- Move the native header helpers duplicated in `test/app/media-detail.test.tsx` and `test/app/not-found.test.tsx` (`NATIVE_HEADER_HOST`, `headerTitles`, `visibleBackButtons`) into a shared helper next to `test/app/app-routes.ts`.

### C-08 Discovery screen
- Discover rows open the media detail like the search rows: `router.push({ pathname: '/media/[namespace]/[kind]/[id]', params: toMediaRouteParams(item.key) })`, with the labels of `src/core/i18n/media-labels.ts` (`@core/i18n/index`, C-07).
- `StatusFilter` (`src/features/search/StatusFilter.tsx`) keeps its own `search.filters.status.*` keys, which duplicate the `media.status.*` keys the detail uses: switch it to `STATUS_KEYS` (`src/core/i18n/media-labels.ts`) when touching the search filters (C-07).
- Retry feedback (C-07 review): the "Try again" action of `MediaDetailView` and of `SearchResults` keeps the `ErrorState` on screen while the refetch runs, and each extra tap cancels and restarts the request (`refetch()` cancels the one in flight): show a spinner while `isFetching`, or call `refetch({ cancelRefetch: false })`; apply the same to the discovery sections.
- French wording (C-07 review): the total units fact is labelled "Longueur" (`mediaDetail.facts.totalUnits`, en "Length"), which reads unnaturally: use a label per kind ("Épisodes" / "Chapitres", "Episodes" / "Chapters") when the shared labels are touched.
- Reuse the search pagination and its background prefetch for top and season pages (`CatalogRequestOptions`, C-06). Adding a format to `getTop` makes the positional optional parameters awkward (`getTop(kind, page, undefined, options)`): consider one options object for the signal, the format and the priority (C-06 review).
- Pagination follow-ups from the C-06 review (`src/features/search/SearchResults.tsx`): show the pagination under the `ErrorState` when the requested page is above 1, as the empty state does; while the placeholder of another search is shown, the pagination shows that search's `lastPage`, so a tap can request a page past the new search's last one (it ends in the empty state with a way back): show only the current page then, or keep and document it.
- Strengthen the C-06 tests: assert in `test/app/search-position.test.tsx` that going back does not scroll the list (no `scrollTo` call), and in `src/features/search/SearchScreen.pagination.test.tsx` that no foreground search of a new query asks for a page other than 1 (instead of `.at(-1)`), with a filters change case besides text and kind.
- `CATALOG_REQUEST_PRIORITIES` (`src/core/catalog/catalog-provider.ts`) is a runtime array used only for its type, and `catalog-http-client.ts` repeats the `'background'` string: use a union type, or `satisfies CatalogRequestPriority` at the use site (C-06 review).
- Move the remaining copies of `settle`, `expectNoPendingTimer` and `elapsed` in `src/core/catalog/jikan/*.test.ts` to `test/core/catalog-http-test-support.ts`; split `src/core/hooks/use-search.test.tsx` (373 lines) and `src/core/catalog/catalog-failure-monitor.test.ts` (308 lines) under the ~300-line rule (C-06).
- FR-05 format chips on top manga (manhwa, manhua) need a format on `CatalogProvider.getTop` (Jikan `/top/manga?type=`): a change to the interface and to the `top` query key (C-03).
- Tenrai's `/seasons/now` also lists titles still airing from earlier seasons, without the `continuing` parameter (recorded 2026-10-14: a winter 2026 title in the fall 2026 list, C-03). Decide whether the current season section keeps them, or drops items whose `season` and `year` differ from the current season (the adapter does not read `season` today).

## Phase 3 — Library (guest first)

- [ ] L-01 Library domain rules BR-01 to BR-05, BR-09 as pure functions
- [ ] L-02 Local (guest) library repository
- [ ] L-03 Add/remove, status, progress `+1` (optimistic + coalesced), score, notes
- [ ] L-04 Library screen: grouping, filters, sorting
- [ ] L-05 Favorites (toggle + tab)
- [ ] L-06 Adult content setting wired to the filter

Details:

### L-02 Local (guest) library repository
- The media snapshot built from `MediaSummary` validates the database limits (title 1-500 characters, which the Jikan adapter does not bound; https image url up to 2048 characters) and always sets `isAdult`, like the A-03 snapshot schema (C-03 review).
- Name the Postgres `integer` bound once in `src/core/domain/` (e.g. `POSTGRES_INTEGER_MAX`) and derive `EXTERNAL_ID_MAX` (`MAL_ID_MAX` before C-03) and the Jikan `TOTAL_UNITS_MAX` (`src/core/catalog/jikan/jikan-fields.ts`) from it (C-03 review).

### L-03 Add/remove, status, progress, score, notes
- The library snapshot refresh "when the detail screen is viewed" (`ARCHITECTURE.md` §5) and the detail screen's library actions (add, status, `+1`, score) come with this item; the favorite star comes with L-05 (C-07).

### L-06 Adult content setting wired to the filter
- Replace the `DEFAULT_SHOW_ADULT` reads of `SearchScreen` (`// TODO(L-06)`), which also feeds the filters sheet, of `MediaDetailView` (`src/features/media-detail/MediaDetailView.tsx`, `// TODO(L-06)`, C-07) and of the Discover sections (`src/features/discovery/`, `// TODO(L-06)`, C-08). Decide what happens to an adult genre already included or excluded when the setting is turned off: its chip is hidden (`isAdultGenreName`), but the applied filters still send it (C-05).
- The detail's hidden message (`mediaDetail.hidden.message`, en and fr) says adult content is off in the settings, a toggle this item adds: recheck the wording, or link to the setting (C-07 review).
- Add a route-level BR-06 test in `test/app/media-detail.test.tsx`: an adult title through the real root layout shows `media-detail-hidden`, and the header titles equal the static `mediaDetail.title`, never the media title (C-07 review).

## Phase 4 — Accounts and sync

- [ ] A-01 Email auth (sign up with confirmation, sign in, reset password), captcha on the auth endpoints (`ARCHITECTURE.md` §9)
- [ ] A-02 Google and Apple sign-in (PKCE)
- [ ] A-03 Supabase library repository + repository switch on auth state
- [ ] A-04 Guest → account merge (BR-08)
- [ ] A-05 Offline write queue and replay
- [ ] A-06 Sign out purge; `delete-account` Edge Function + in-app flow

Details:

### A-03 Supabase library repository
- The snapshot Zod schema uses the database limits (title 1-500, format 1-32, https image url up to 2048 characters); add `lives_ok` cases at exactly these accepted limits in `supabase/tests/database/030-library-entries.test.sql` (F-08 review).
- `library_entries.media_is_adult` defaults to `false`, which fails open (BR-06): snapshot writes must always set it from `MediaSummary.isAdult`; consider dropping the default in a migration (C-03 review).
- Two `throws_ok` cases of `supabase/tests/database/030-library-entries.test.sql` (the external id check and the duplicate entry) pass a null message, so the constraint names `library_entries_external_id_check` and `library_entries_user_media_key` are never asserted (C-03 review): assert the Postgres messages that name them.
- Every write names the media identity `(id_namespace, external_id)` from the `MediaKey` (`namespace`, `externalId`): `id_namespace` has no default (C-03, ADR-0013), and the upsert conflict target is `(user_id, id_namespace, media_kind, external_id)`.

### A-05 Offline write queue and replay
- A foreground request that joins an in-flight background prefetch and fails is observed twice by the catalog failure monitor (once per provider call, C-06 review): count a shared failure once, or record it as accepted in `ARCHITECTURE.md` §3.
- Wire TanStack Query's `onlineManager` to the device connectivity, so offline catalog queries pause and resume on reconnect instead of failing after the network retries of the catalog http client (C-02). This also keeps a viewed media detail in the persisted cache: today a stale detail opened offline fails its refetch, goes to `error` and is left out of the next persister write (`shouldDehydrateQuery`, `src/core/query/persister.ts`), so it no longer reads after the next offline cold start (C-07 review); add a test that a failed offline refetch keeps the persisted detail. `onlineManager` covers the offline device only: a refetch failing while online (timeout, 5xx) still drops the detail from the stored cache; decide whether to persist the last successful data of a failed query too. A connectivity module (`expo-network` or NetInfo) is a new dependency to justify in the PR.
- Count network errors in the catalog failure monitor (`src/core/catalog/catalog-failure-monitor.ts`) while the device is online (C-03): they are ignored today, because an offline device and a provider outage at the DNS or TCP level look the same, so a provider that stops resolving is not reported.

### A-06 Sign out purge and account deletion
- Sign out purges the recent searches (`RecentSearchesRepository.clear`, FR-25): they are personal data kept on the device (C-04).

## Phase 5 — Release

- [ ] R-01 E2E suite complete (critical flows)
- [ ] R-02 Performance pass (cold start, list FPS, bundle size)
- [ ] R-03 Accessibility pass
- [ ] R-04 MASVS L1 security review
- [ ] R-05 Privacy policy, store listings, screenshots, age rating
- [ ] R-06 Internal testing: TestFlight + Play internal track

Details:

### R-01 E2E suite complete
- Run the Maestro suite in CI on a GitHub-hosted Android emulator against the development build (after F-09), starting with the F-03 smoke flow (never run yet).
- Release PRs to `main` also run the E2E suite (moved from F-04). Until then, the owner runs `pnpm test:e2e` locally before merging a release PR.

### R-02 Performance pass
- Cache the `Intl.NumberFormat` / `Intl.DateTimeFormat` instances of `src/core/i18n/format.ts` per language and options (created on every call since F-06), or earlier if a list screen formats values in its rows.

### R-03 Accessibility pass
- Filters sheet section titles (`src/features/search/FilterChoice.tsx`, `GenresFilter.tsx`) use `Text variant="subtitle"` without a header role: add a heading option to the ui `Text` (`accessibilityRole="header"`) so screen readers can jump between sections (C-05 review).
- Genre chips announce their state twice: the label names it ("Action, included") and `accessibilityState.selected` adds "selected" ("excluded, not selected" for an excluded chip). Leave `selected` out of the state when the label already names it (C-05 review).
- The `Sheet` primitive has no keyboard avoidance: the keyboard can cover the year field of the filters sheet on small screens. Use `KeyboardAvoidingView` or `automaticallyAdjustKeyboardInsets` on its scroll body (C-05).
- The `Sheet` backdrop dims with the `background` token at the `pressed` opacity: add a scrim color token to the theme with a checked contrast (C-05).

### R-04 MASVS L1 security review
- Review the unencrypted MMKV instance (F-09, owner decision): it holds the persisted query cache and the preferences, never the session. Decide whether user data in the cache (library notes from A-03) needs MMKV encryption with a key kept in secure-store.
- Per-user quotas or rate limiting on writes: an authenticated user can insert unlimited `library_entries` and grow `progress_events` without bound by toggling progress (F-08 review). Decide a cap (row limit trigger or Edge Function) and add the threat to `ARCHITECTURE.md` §9.
- Stray session chunks after a kill (F-11 review): the per-key dirty state of `src/platform/secure-session.ts` lives in memory, so if the app is killed between writing the chunks and the cleanup, chunks of an older session stay in the keychain until a removal or a missing or invalid header triggers a sweep. Decide whether to persist the dirty marker or sweep once per launch.
- Test the success paths of `tools/ci/check-eas-preview-scope.mjs` (F-11 review): stdin to `build=true|false` in `GITHUB_OUTPUT`, and `FORCE_ALL` ignoring stdin.
- Sentry notes scrubbing gaps (F-11 review): an unquoted colon value (`notes: rewatch with my sister`) and a prefix longer than 40 characters before `notes=` are not redacted, and a malformed value with no closing quote can hide a later `notes` member from the scrubber. Cover them in `src/platform/sentry-scrub.ts` or record them as accepted limitations in `ARCHITECTURE.md` §9.
- Covers are loaded only by the ui `CoverImage` from `MediaSummary.imageUrl`, which passed the provider's CDN allowlist (C-04). Ban the react-native `Image` and `ImageBackground` imports in `app/` and `src/features/`, so a screen cannot load an image around `CoverImage`.

### R-05 Privacy policy, store listings, screenshots, age rating
- The privacy policy states that the catalog provider receives the user's IP address and User-Agent with every catalog request: Tenrai, the default instance, logs them for up to 90 days (its privacy policy, C-03, ADR-0013). Name the active provider and update the policy whenever the instance changes (self-hosted Jikan, AniList).

## Catalog fallbacks (on demand, outside the phase order)

Taken only when the owner triggers them (provider outage or discontinuation, or an authorization), not in backlog order. Strategy (ADR-0013): AniList if authorized, else a self-hosted Jikan.

- [ ] C-09 AniList adapter (pending authorization)
- [ ] C-10 Self-hosted Jikan

Details:

### C-09 AniList adapter (pending authorization)
- Starts only after AniList authorizes the app. Terms to recheck first: free under $150 of revenue per month, a commercial licence above, so any monetization triggers a review; the app name must not contain "AniList".
- A new adapter folder next to `jikan/` (GraphQL over POST: the catalog http client gains a dedup key that includes the body), added to `CATALOG_ADAPTER_FOLDERS` and the provider host lint guard, passing the shared contract suite (`test/core/catalog-provider-contract.ts`), with its own rate limiter instance and recorded fixtures.
- Media id namespace (deferred from C-03): AniList ids get their own namespace (`anilist`) unless this item decides a mapping to `mal` through `idMal`. Add the AniList cross-reference column on `library_entries` (an AniList id next to the MAL `external_id`, nullable, per-user unique) in a new migration with pgTAP tests, so existing `mal` entries and AniList results can be matched.
- Distinct from A-07 (AniList account sync).
- Before a second adapter relies on the contract suite (C-03 review): its `page` and `detail` scenarios only check that `isAdult` is a boolean, so an adapter flagging every item adult passes. Require these scenarios to serve non-adult items (harness doc in `test/core/catalog-provider-contract-support.ts`) and assert `isAdult === false` for them.

### C-10 Self-hosted Jikan
- Run a jikan-rest instance (hosting, its own cache, MyAnimeList scraping limits, monitoring), https only.
- Switch the app with one value: `EXPO_PUBLIC_JIKAN_BASE_URL` in the EAS environments (C-03), then a build, or an update published with its environment. The adapter applies `SELF_HOSTED_JIKAN_RATE_LIMIT` (the public Jikan's documented limits); tune it to the instance's real limits if needed.
- Update the privacy policy (R-05) and ADR-0013's terms summary.
- The Discover "This season" section shows Tenrai's `/seasons/now`, which also lists titles still airing from earlier seasons; a self-hosted Jikan without the `continuing` parameter (never sent, ADR-0004) lists only the season's new titles. Accepted difference (C-08): check it on the instance and mention it in the switch notes.
- Before a self-hosted URL is used (C-03 review): `selfHostedJikanInstance` (`src/core/catalog/jikan/jikan-instances.ts`) checks only the https prefix and the trailing slash, and the app env URL pattern (`src/core/schemas/app-env.ts`) accepts `.` and `..` path segments. Export one core URL pattern, use it in both, and reject dot segments.

## Maintenance (recurring, never ticked)

- [ ] M-01 Dependency update (recurring)

Details:

### M-01 Dependency update
- Done under the owner's identity on a `chore/deps-update-<date>` branch (single author: no update bot, Dependabot alerts only).
- Respect the pins:
  - Expo-managed packages (`expo`, `expo-*`, `jest-expo`, `react`, `react-dom`, `react-native`, `react-native-*`, `@react-native/*`, `@types/react`, the `pnpm-workspace.yaml` overrides) only via `expo install --fix` on the current SDK line (patch only); SDK upgrades are their own item.
  - `jest`, `@jest/globals` and `jest-environment-jsdom` below 30, on the major the Expo SDK test stack supports.
  - `test-renderer` below 1.3 until the Expo SDK ships React 19.3 or later (1.3 requires it).
  - Node major unchanged.
- Bump the pinned GitHub Action SHAs (with their version comments) in `.github/workflows/*.yml` and `.github/actions/setup/action.yml`, and the gitleaks version and sha256 in `.github/workflows/ci.yml`.
- Respect pnpm's `minimumReleaseAge`.
- `pnpm check` and `pnpm test:rls` green; code review approved (CONTRIBUTING.md section 8).
