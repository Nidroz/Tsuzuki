# Architecture

This document describes how Tsuzuki is built. Decisions and their rationale live in [`adr/`](./adr). Keep this file in sync with the code: any structural change updates it in the same PR.

## 1. Overview

```mermaid
flowchart LR
    subgraph App[Expo app]
        UI[app/ + features/ + ui/]
        Core[src/core]
        Platform[src/platform]
    end
    UI --> Core
    UI --> Platform
    Core -->|CatalogProvider| Jikan[Jikan v4 compatible API<br/>Tenrai by default]
    Core -->|Repositories| SB[Supabase Auth + Postgres + RLS]
    Platform --> MMKV[(MMKV: cache, guest data)]
    Platform --> Secure[(Secure store: session)]
    SB --> EF[Edge Functions]
```

- The **catalog** (titles, search, discovery) comes from an external provider behind the `CatalogProvider` interface: today a Jikan v4 compatible API, Tenrai by default or a self-hosted Jikan by configuration (ADR-0013).
- **User data** (library, favorites, preferences) lives in Supabase for signed-in users, and in MMKV for guests.
- The app never talks to a provider or to Supabase outside `src/core/`.

## 2. Folder structure

```
tsuzuki/
├── app/                              # expo-router routes (thin)
│   ├── _layout.tsx                   # composition root: app env, error reporter, storage, monitored catalog provider, recent searches repository, persisted query client, preferences, i18n, theme + root Stack (supabase client wired with its first consumer, §8)
│   ├── (tabs)/
│   │   ├── _layout.tsx               # Tabs from expo-router/js-tabs, five tabs
│   │   ├── index.tsx                 # discovery, the route /
│   │   ├── search.tsx
│   │   ├── library.tsx
│   │   ├── favorites.tsx
│   │   └── settings.tsx
│   ├── media/[namespace]/[kind]/[id].tsx # media detail: raw params passed to the feature screen
│   ├── +not-found.tsx                # unmatched links: translated error, back to Discover
│   └── (auth)/sign-in.tsx, sign-up.tsx
├── src/
│   ├── core/                         # platform-agnostic, shareable with a future Next.js app
│   │   ├── domain/                   # entities, business rules (BR-xx), content filter
│   │   │   ├── media.ts              # MEDIA_KINDS, MediaKind, MEDIA_ID_NAMESPACES ('mal'), MediaIdNamespace, MediaKey { namespace, kind, externalId }, EXTERNAL_ID_MAX, isMediaKind; ANIME/MANGA/MEDIA_FORMATS, MEDIA_FORMATS_BY_KIND, MEDIA_STATUSES (publication), SEARCHABLE_MEDIA_STATUSES (ADR-0013)
│   │   │   ├── content-filter.ts     # BR-06: ADULT_GENRE_NAMES (lowercase const tuple), isAdultMedia (used by adapters), applyContentFilter, DEFAULT_SHOW_ADULT (false) (§7)
│   │   │   ├── search-query.ts       # prepareSearchQuery(raw, maxLength) -> string | null: the query sent for a search field value; isSearchQueryMaxLength (§6)
│   │   │   └── recent-searches.ts    # FR-02: RECENT_SEARCHES_MAX (10), normalizeRecentSearches, addRecentSearch (§6)
│   │   ├── schemas/                  # zod schemas for user input, route params and db rows
│   │   │   ├── media-route-params.ts # media detail route params { namespace, kind, id } -> MediaKey, parseMediaRouteParams; toMediaRouteParams(key), its inverse, for links to the detail route
│   │   │   └── app-env.ts            # build-time env (variant, https supabase url, anon key, optional sentry dsn, optional jikanBaseUrl), shared by app.config.ts and the startup reader (§10)
│   │   ├── catalog/
│   │   │   ├── catalog-provider.ts   # CatalogProvider interface (namespace, instanceId, searchQueryMaxLength) + normalized types
│   │   │   ├── catalog-failure-monitor.ts # monitorCatalogProvider(provider, { reporter, now? }): reports sustained provider failures through the ErrorReporter, results and errors unchanged, fields forwarded (§3)
│   │   │   ├── search-params.ts      # normalizeSearchParams: canonical SearchParams for the search query key (§6)
│   │   │   ├── image-url.ts          # toAllowedImageUrl(value, allowedHosts): an untrusted image url kept only when https on an allowed cdn host, else null; IMAGE_URL_MAX_LENGTH 2048 (§9)
│   │   │   ├── http/                 # catalog http client used by the adapters: rate limit, in-flight dedup, retries (§3, §6)
│   │   │   │   ├── rate-limiter.ts   # createRateLimiter(policy, { now? }) -> { acquire(signal?), pauseFor(ms) }: token buckets (GCRA), FIFO queue, one timer for the head; monotonic now, default performance.now()
│   │   │   │   ├── in-flight-dedup.ts # identical in-flight GETs (exact url) share one abortable operation with a caller count; nothing cached
│   │   │   │   ├── retry-policy.ts   # DEFAULT_RETRY_POLICY (4 attempts, equal-jitter backoff, 20 s deadline), parseRetryAfter
│   │   │   │   ├── abortable.ts      # sleep(ms, signal?), raceAbort(promise, signal) + abort listener helpers: aborted and add/removeEventListener only (RN AbortController polyfill)
│   │   │   │   └── catalog-http-client.ts # createCatalogHttpClient({ rateLimit, retry?, timeoutMs?, random?, now?, wallClock? }) -> { getJson(url, signal?) }, one limiter and dedup map per client; now: monotonic (limiter, retry deadline), wallClock: Retry-After dates only
│   │   │   └── jikan/                # jikan v4 compatible adapter, one for every instance (C-03, §3, ADR-0013): requests through its own catalog http client
│   │   │       ├── jikan-catalog-provider.ts # createJikanCatalogProvider(instance, options?) -> CatalogProvider (namespace mal, instanceId, searchQueryMaxLength JIKAN_QUERY_MAX_LENGTH), builds its client from instance.rateLimit; wired by the composition root
│   │   │       ├── jikan-instances.ts # JikanInstance { id, baseUrl, rateLimit }: TENRAI_INSTANCE (id tenrai, the default), selfHostedJikanInstance(baseUrl) (id jikan-self-hosted), jikanInstanceFor(baseUrl | undefined)
│   │   │       ├── jikan-urls.ts     # deterministic request urls relative to the instance base url, JIKAN_PAGE_LIMIT (25), JIKAN_QUERY_MAX_LENGTH (300), input guards (RangeError), jikanYearRange
│   │   │       ├── jikan-fields.ts   # jikan status and type values, display field normalization (titles, unit counts, score, year)
│   │   │       ├── jikan-schemas.ts  # zod schemas of the page, detail and genre list payloads; an item parses to a JikanEntry
│   │   │       ├── jikan-mappers.ts  # JikanEntry -> MediaSummary, MediaDetail, Page; genres, isAdult (BR-06), cover (JIKAN_IMAGE_HOSTS); a schema failure -> CatalogResponseError
│   │   │       ├── jikan-rate-limit.ts # TENRAI_RATE_LIMIT { 2 tokens, 1 per 750 ms }; SELF_HOSTED_JIKAN_RATE_LIMIT { 2 tokens, 1 per 750 ms } and { 10 tokens, 1 per 1.5 s } (§6)
│   │   │       └── __fixtures__/     # jikan-builders.ts (payload builders in the shape of the published openapi spec), jikan-endpoints.ts (the per-endpoint test cases), jikan-handlers.ts (msw handlers per instance base url); tenrai/: recorded Tenrai responses trimmed for the repository (JSON) and a README on how they were recorded and trimmed (§12)
│   │   ├── repositories/
│   │   │   ├── storage-adapter.ts    # StorageAdapter: synchronous string key-value storage, never secrets (MMKV on mobile)
│   │   │   ├── session-storage.ts    # SessionStorage: async auth session storage, supabase-js auth.storage shape (secure-store on mobile)
│   │   │   ├── recent-searches-repository.ts # RecentSearchesRepository: synchronous load, save(list), clear() (§6)
│   │   │   ├── library-repository.ts # interfaces
│   │   │   ├── profile-repository.ts
│   │   │   ├── supabase/             # supabase implementations, database.types.ts (generated)
│   │   │   │   └── create-supabase-client.ts # client factory: anon key, injected SessionStorage, pkce (§8)
│   │   │   └── local/                # device and guest implementations (storage injected from platform)
│   │   │       └── recent-searches-repository.ts # createLocalRecentSearchesRepository(storage, { maxQueryLength }): key recent-searches, JSON array parsed with zod (§6)
│   │   ├── hooks/                    # react hooks over the repository and CatalogProvider interfaces, consumed by feature screens (§6)
│   │   │   ├── catalog-context.ts, CatalogContextProvider.tsx, use-catalog-provider.ts   # the CatalogProvider given by the composition root; useCatalogProvider throws outside CatalogContextProvider
│   │   │   ├── recent-searches-context.ts, RecentSearchesContextProvider.tsx, use-recent-searches.ts   # the RecentSearchesRepository; useRecentSearches: { searches, add, clear }, throws outside its provider
│   │   │   ├── use-debounced-value.ts # useDebouncedValue(value, delayMs)
│   │   │   ├── filtered-page.ts      # FilteredPage<T> (a Page plus hiddenCount), selectFilteredPage(showAdult): one stable select function per value (BR-06, §7)
│   │   │   └── use-search.ts         # SEARCH_DEBOUNCE_MS (400), useSearch(params | null, { showAdult })
│   │   ├── query/
│   │   │   ├── query-client.ts       # createQueryClient: a new client per call, gcTime 7 days, retry off
│   │   │   ├── persister.ts          # createQueryPersister over StorageAdapter, createPersistOptions: success queries except search (§6)
│   │   │   ├── keys.ts               # query key factory (§6)
│   │   │   ├── stale-times.ts        # STALE_TIMES per query family, SEARCH_GC_TIME (30 min), PERSISTED_CACHE_MAX_AGE
│   │   │   └── cache-schema-version.ts # CACHE_SCHEMA_VERSION, part of the persisted cache buster (§6)
│   │   ├── errors/
│   │   │   ├── catalog-errors.ts     # CatalogError base: CatalogHttpError (status, retryAfterMs), CatalogNetworkError, CatalogTimeoutError (timeoutMs), CatalogResponseError (malformed body, zod failure in adapters), CatalogAbortedError (name AbortError, Hermes has no DOMException); no url, query, search text, underlying message or cause (§9). CATALOG_FAILURE_KINDS and CatalogProviderFailureError (kind), reported by the failure monitor (§3)
│   │   │   ├── app-env-error.ts      # AppEnvError: invalid app env, lists the invalid field names only, never their values (ADR-0012)
│   │   │   └── error-reporter.ts     # ErrorReporter port (captureError) + ErrorContext (source, non-personal tags), implemented by src/platform/sentry.ts
│   │   ├── i18n/                     # i18next, the only place importing it (ADR-0011); public api: index.ts (@core/i18n/index, enforced by lint in routes, features and platform)
│   │   │   ├── en.json, fr.json      # single translation namespace, keys nested by feature; en.json is the key source
│   │   │   ├── languages.ts          # supported en/fr, fallback en, preference system | en | fr (default system)
│   │   │   ├── resolve-language.ts   # preference + device tags -> language; device-language-tags.ts parses the tags with zod
│   │   │   ├── locale-adapter.ts     # LocaleAdapter interface (useDeviceLanguageTags), implemented in platform
│   │   │   ├── create-i18n.ts        # a new i18next instance per call, bundled resources, onMissingKey callback
│   │   │   ├── I18nProvider.tsx, i18n-context.ts, use-translation.ts   # own react context (no react-i18next); useTranslation: t, language, formatNumber, formatDate
│   │   │   ├── format.ts             # number and date formatting with a required language
│   │   │   └── i18next.d.ts          # keys typed from en.json (strictKeyChecks)
│   │   └── preferences/              # theme and language preferences, own react context like i18n; public api: index.ts (@core/preferences/index, by convention, not lint-enforced)
│   │       ├── preferences.ts        # THEME_PREFERENCES system | light | dark, ThemePreference, DEFAULT_THEME_PREFERENCE (system); the language preference stays in i18n/
│   │       ├── preferences-storage.ts # loadPreferences (zod, invalid -> system), saveThemePreference, saveLanguagePreference over StorageAdapter; keys preferences.theme, preferences.language
│   │       └── PreferencesProvider.tsx, preferences-context.ts, use-preferences.ts   # controlled provider holding no state; usePreferences: theme, language, setTheme, setLanguage
│   ├── features/                     # screen components rendered by the routes, e.g. discovery/DiscoveryScreen.tsx
│   │   ├── search/                   # SearchScreen (field, kind switch, recent searches or results), SearchKindSwitch, RecentSearchesList, SearchResults (list, states, hidden note), SearchResultRow (memoized MediaSummary -> MediaListItem); FiltersSheet (C-05), pagination (C-06)
│   │   ├── discovery/                # DiscoveryScreen (placeholder until C-08)
│   │   ├── library/                  # LibraryScreen (placeholder until L-04)
│   │   ├── media-detail/             # MediaDetailScreen: parses the route params (placeholder until C-07)
│   │   ├── favorites/                # FavoritesScreen (placeholder until L-05)
│   │   ├── auth/
│   │   └── settings/                 # SettingsScreen: theme and language pickers
│   ├── ui/                           # the only layer that uses NativeWind
│   │   ├── index.ts                  # public api: routes and features import from @ui/index
│   │   ├── theme/
│   │   │   ├── colors.ts, spacing.ts, radii.ts, typography.ts, sizes.ts   # design tokens (sizes: touch target, icon, cover sizes)
│   │   │   ├── css-variables.ts      # color token -> css variable (--color-<token>)
│   │   │   ├── tailwind.config.ts    # tailwind scales built from the tokens
│   │   │   ├── global.css            # tailwind entry compiled by nativewind in metro
│   │   │   ├── ThemeProvider.tsx     # system/light/dark, palette variables, status bar, navigation theme, native root view background
│   │   │   └── theme-context.ts      # useThemeColors, for props that take a color value
│   │   └── components/               # primitives: Screen, Box, Stack, Row, Spacer, Text, Button, IconButton, TabBarIcon, Card, Input, Chip, RadioGroup, Spinner, EmptyState, ErrorState, Pagination, List (FlashList), CoverImage (expo-image), MediaListItem
│   │       ├── icons.ts              # glyph table by meaning (IconButton) + outline/filled pair per tab (TabBarIcon)
│   │       ├── layout/               # token -> class tables shared by the primitives
│   │       └── pagination/           # page window logic, PageButton, JumpToPage
│   └── platform/
│       ├── locale.ts                 # expo-localization device language tags implementing core LocaleAdapter
│       ├── storage.ts                # createStorage: one unencrypted MMKV instance (id tsuzuki) implementing core StorageAdapter
│       ├── secure-session.ts         # createSecureSessionStorage: chunked expo-secure-store implementing core SessionStorage, crash-safe generation switch, calls queued per key (§8)
│       ├── app-version.ts            # APP_VERSION from expo-constants, part of the persisted cache buster
│       ├── intl-polyfills.ts         # Intl.PluralRules polyfill, imported first by the root layout
│       ├── app-env.ts                # readAppEnv(parse): reads extra.env from expo-constants and re-parses it with the injected core parseAppEnv (platform imports core types only)
│       ├── sentry.ts                 # @sentry/react-native: initSentry (errors only), isSentryEnabled, createErrorReporter implementing core ErrorReporter; the only production file allowed to use console
│       └── sentry-scrub.ts           # pure scrubbers: scrubEvent (beforeSend), scrubBreadcrumb (beforeBreadcrumb)
├── supabase/
│   ├── migrations/
│   ├── functions/delete-account/
│   ├── tests/                        # pgTAP
│   └── seed.sql
├── e2e/                              # Maestro flows
├── test/                             # shared test infrastructure (see §12)
│   ├── core/                         # core project setups (setup.ts with the msw server, setup-dom.ts), determinism helpers shared with the mobile setup (fixed-clock.ts, fail-on-console.ts, no-network.ts), msw server factory, i18n catalog parity checker (i18n-catalog-parity.ts), catalog provider contract suite (catalog-provider-contract.ts: describeCatalogProviderContract(harness), run by every adapter, §3), the catalog provider contract boundary cases (catalog-provider-contract-boundaries.ts: search text limit, cover allowlist), an in-memory recent searches repository (fake-recent-searches-repository.ts); the strict fake catalog provider lives in `src/core/catalog/__fixtures__/fake-catalog-provider.ts` (createStrictFakeCatalogProvider: every method not overridden rejects; instance `fake-instance`, limit 42, so a test proves the limit is forwarded), their tests; core lint bans apply
│   ├── app/                          # route tests (renderRouterAsync); kept out of app/, where every .tsx is a route
│   └── mobile/                       # mobile project setup and its tests, helpers (renderRouterAsync, renderWithTheme, renderWithProviders: real catalogs and a missing key failing the test, options `{ language?, catalogProvider?, recentSearchesRepository?, queryClient? }` with a fresh query client, the strict fake catalog provider and an in-memory recent searches repository by default; renderSearchScreen, classesOf, shared-mmkv), .css stub
├── tools/                            # repository tooling, tested with node:test
│   ├── ci/                           # base branch policy for the PR policy workflow; eas-preview-scope.mjs: whether a push to dev runs the preview build (§10)
│   ├── commitlint/                   # commitlint.config.mjs tests
│   ├── expo/                         # resolve-ts-imports.cjs: node resolve hook loaded first by app.config.ts, so it can import the core app env schema (node >= 22.18); eas-update.mjs: `pnpm update:publish <variant>` (§10); their tests
│   ├── jest/                         # jest.config.mjs tests (tsconfig alias mapping, test globs)
│   └── eslint/                       # rule tables for eslint.config.mjs (layers.mjs, import-bans.mjs, syntax-guards.mjs, text-guards.mjs, test-hygiene.mjs and helpers), their regression tests, case tables (layers-*-cases.mjs) and probe tables (layers-text-probes.mjs)
│       └── plugin/                   # local eslint rules: backlog-reference, file-name-case
├── docs/  (ARCHITECTURE.md, BACKLOG.md, adr/)
├── .github/
│   ├── actions/setup/                # composite action: pnpm install --frozen-lockfile, store cached on the lockfile hash
│   └── workflows/                    # ci.yml, pr-policy.yml, codeql.yml, release-please.yml, eas-preview.yml, release.yml, back-merge.yml (see §10)
├── babel.config.js, metro.config.js  # nativewind scoped to src/ui (see below); metro built on getSentryExpoConfig
├── app.config.ts, eas.json           # app variant by APP_VARIANT, env validated into extra.env, config plugins (expo-router, expo-secure-store, expo-localization, @sentry/react-native with the org/project slugs and eu url), expo-updates; eas build profiles, channels and environments, remote app version source (§10)
├── .env.example                      # build-time env variables with placeholders (.env.local is git-ignored)
└── release-please-config.json, .release-please-manifest.json
```

Layer rules are defined in `CONTRIBUTING.md` §4 and enforced by ESLint; their tables live in `tools/eslint/layers.mjs` (`layerRules`, `LAYERS`, `LAYER_ZONES` and the network constants) and `tools/eslint/import-bans.mjs` (the banned import tables `BANNED`, `CANONICAL_PATHS` and `PLATFORM_CORE_TYPE_ONLY`).

- Only the root layout `app/_layout.tsx`, the composition root, wires the repository and catalog provider implementations (`src/core/repositories/supabase/`, `src/core/repositories/local/`, `src/core/catalog/jikan/`). Every other route, nested layouts included, and every feature goes through `src/core/hooks/`. Everything else in `src/core/` (domain, schemas, query, errors, i18n, hooks, and the interface files at the root of `repositories/` and `catalog/`) and in `test/core/` depends only on the repository and `CatalogProvider` interfaces, never on the implementation folders.
- Only provider adapters use the catalog http client (`src/core/catalog/http/`). Routes and features, `app/_layout.tsx` included, never import it: they reach the catalog through `src/core/hooks/`. Nor does the rest of `src/core/`, i.e. every file outside the provider adapter folders (`CATALOG_ADAPTER_FOLDERS` in `tools/eslint/layers.mjs`, today `catalog/jikan/`) and the http folder itself, the root files of `src/core/catalog/` and the repository implementations (`repositories/supabase/`, `repositories/local/`) included, or `test/core/`: they depend on the `CatalogProvider` interface (two lint zones in `tools/eslint/layers.mjs`, regression cases in `tools/eslint/layers-cases.mjs`).
- Routes, features and UI components have no direct network access: `app/`, `src/features/` and `src/ui/` never use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `expo/fetch` or Expo internals (`expo/src/…`, `expo/build/…`). Network access lives in `src/core/` (catalog adapters and repositories), with `src/platform/` for mobile SDKs.
- Every file under `src/` belongs to one of the four layers (`src/core/`, `src/features/`, `src/ui/`, `src/platform/`), so each file gets the rules of exactly one layer.
- Import paths are written canonically, because the package bans and barrel rules read the specifier text: in every layer, `CANONICAL_PATHS` rejects a `node_modules` path, a `..` segment after another segment (`@core/../x`), a `.` segment after the first one and empty segments (`@core/./i18n/x`, `@core//i18n/x`, a trailing `/`), which would otherwise bypass the barrel rules. Leading `./`, `.` and `../` segments stay allowed. It applies to static imports, re-exports, `import()` and jest module calls; its cases are in `tools/eslint/layers-canonical-cases.mjs`.
- Jest module calls (`jest.mock`, `doMock`, `requireActual`, `unmock`, `setMock`…) take a string literal and follow the package bans and canonical paths of their layer, like imports; `jest` is imported from `@jest/globals` under its own name and its methods are called by name, directly on `jest`: aliases, computed access, calls chained on a returned `jest` and re-exports of `@jest/globals` are rejected (a returned `jest` stored in a variable is beyond a syntax check).
- Production code (non-test files in `app/` and `src/`) never imports the test infrastructure in `test/`: only tests do.
- NativeWind is applied to `src/ui/` only (ADR-0007). `babel.config.js` enables its JSX transform through an override scoped to `src/ui/` (applied globally, it would pull `react-native-css-interop`, and React Native with it, into `src/core/`), and `metro.config.js` compiles `src/ui/theme/global.css` with `src/ui/theme/tailwind.config.ts`, whose `content` scans `src/ui/` only. A `className` anywhere else produces no style, and lint rejects it: `className` and its variants (`*ClassName` props and object keys) are used only inside `src/ui/`, and `nativewind` / `react-native-css-interop` imports are banned in every other layer.
- The tokens in `src/ui/theme/` (colors, spacing, radii, typography, sizes) are the single source of the Tailwind scales. `tailwind.config.ts` replaces Tailwind's default color, spacing, radius, font size, font weight and opacity scales (`theme`, not `theme.extend`), so only token classes exist for them (`p-lg`, `rounded-md`, `text-title`, `bg-surface-muted`) and a raw value cannot slip in; lengths are written in px, mapped 1:1 to dp. Each color is a CSS variable (`rgb(var(--color-<token>) / <alpha-value>)`), so no `dark:` variant is needed. Props that take a color value instead of a class (spinner, placeholder, icon) read the active palette with `useThemeColors`, internal to `src/ui/`.
- `ThemeProvider` resolves the preference (`system`, `light` or `dark`; `system` follows the device setting) to a scheme, sets the palette variables of that scheme on the whole tree, drives the native appearance through NativeWind and renders the status bar. The preference is held and persisted by the composition root (`app/_layout.tsx`, see "Root layout"), and changed by the settings theme picker through `PreferencesProvider` (see below).
- `ThemeProvider` also provides the navigation theme: it wraps its children in expo-router's `ThemeProvider` with a theme built from the active palette (`dark` = the resolved scheme; colors `primary` → `primary`, `background` → `background`, `card` → `surface`, `text` → `text`, `border` → `border`, `notification` → `danger`; `fonts` from expo-router's `DefaultTheme`), so navigator backgrounds, headers and the tab bar follow the palette and dark mode shows no light flash during transitions. Whenever the scheme changes it also sets the native root view background to the palette background with `expo-system-ui` (`SystemUI.setBackgroundColorAsync`), so an explicit dark preference on a light system does not flash the light root view. A failure of that call goes to the optional `onError(error: unknown)` prop, which the composition root wires to the `ErrorReporter` (`src/ui/` imports neither core nor platform); without it the failure is dropped. Raw palette values still never cross the `@ui/index` barrel. `src/ui/` thus imports `expo-router` (for the theme only) and `expo-system-ui`; its lint entry allows both.
- `src/ui/` also wraps the two rendering packages of the lists (§6), so screens get them only through primitives: `List` over `@shopify/flash-list` and `CoverImage` over `expo-image` (both installed with `pnpm exec expo install`). They are imported only in `src/ui/`: a banned group `uiOnlyPackages` (`^expo-image($|/)`, `^@shopify/flash-list($|/)`, `tools/eslint/import-bans.mjs`) applies to every other layer, `src/core/` (where the `expo` group already covers `expo-image`), `src/platform/`, routes and features with their test code, with cases in the layer case tables. A cover therefore renders only through `CoverImage`, which takes the `imageUrl` of a catalog item as given (§9).
- `I18nProvider` (`src/core/i18n/`, ADR-0011) creates with `useMemo` one never-mutated i18next instance per `[language, onMissingKey]` (no global singleton), initialized synchronously with the bundled `en.json` and `fr.json`, fallback `en`, and exposes it through the module's own React context. `t` comes from `instance.getFixedT(language, 'translation')`, so the render that receives a new language already translates with it: no stale frame, no shared state mutated during render. react-i18next is not used: its `useTranslation` caches `t` per language and revision, not per instance, so it would keep a stale `t` and handler, and the binding is a few lines. `onMissingKey` must be stable (module level or memoized). The language preference (`system`, `en` or `fr`) is held and persisted by the composition root like the theme preference (default `system`) and changed by the settings language picker through `PreferencesProvider`. The composition root reads the device language tags through the core `LocaleAdapter` hook, implemented in `src/platform/locale.ts` with `expo-localization`'s reactive `useLocales()` so the tags follow OS changes, and resolves the language with the pure `resolveLanguage`: an explicit preference wins, `system` takes the first device tag whose primary subtag is supported, otherwise `en`. The tags are untrusted and parsed with Zod (a non-array gives none, invalid entries are dropped). The composition root reports, in every build, missing keys, i.e. keys found in no catalog of the chain (each key once per language; a key present only in `en.json` resolves through the fallback and is not reported; the parity test catches it), and once a missing `Intl.PluralRules` (i18next would fall back silently to a one/other rule, wrong for French 0; `src/platform/intl-polyfills.ts` should make it unreachable). Both go through the `ErrorReporter`: Sentry in release builds, the console in development.
- Routes and features translate with `useTranslation` from `@core/i18n/index`, the module's public API (like `@ui/index`, enforced by lint, see below; `createI18n`, `resources` and the device tag Zod schema are internal, and their tests import their modules). `useTranslation()` throws outside `I18nProvider` and returns `t` with keys typed from `en.json` (`strictKeyChecks`: an unknown key fails typecheck), the active `language`, and `formatNumber` / `formatDate`, which always format with that language, never the machine locale. Catalogs are one `translation` namespace with keys nested by feature; plurals use i18next suffixes selected by `Intl.PluralRules` (French needs `_one`, `_many` and `_other`). `i18next` is imported only inside `src/core/i18n/`; lint bans `i18next` and `react-i18next` everywhere else. The i18n hook lives with its module; `src/core/hooks/` is for data hooks over the repository and `CatalogProvider` interfaces.
- `PreferencesProvider` (`src/core/preferences/`, a React context like i18n) exposes the theme and language preferences to routes and features, which import the module through its public API `@core/preferences/index` by convention (not lint-enforced). The provider is controlled and holds no state: it takes `theme`, `language`, `onThemeChange` and `onLanguageChange` props, and `usePreferences()` returns `{ theme, language, setTheme, setLanguage }`, memoized, and throws outside the provider. The composition root owns both states and persists them through the core `StorageAdapter` with `src/core/preferences/preferences-storage.ts`: `loadPreferences` reads `preferences.theme` and `preferences.language` synchronously and parses them with Zod (a missing or unknown value gives `system`), `saveThemePreference` / `saveLanguagePreference` write a choice. `THEME_PREFERENCES` (`system`, `light`, `dark`), `ThemePreference` and `DEFAULT_THEME_PREFERENCE` (`system`) are declared in core because core cannot import `src/ui/`; a type test proves `ThemePreference` equals ui's `ColorSchemePreference`. The language preference type and default stay in `src/core/i18n/`.
- Routes and features never hard-code user-facing text. In production files of `app/` and `src/features/`, lint rejects text, a string or template literal containing a letter of any script (`\p{L}`; punctuation, digits and spaces stay allowed): JSX text and string literal children (`{'…'}`); text props (`label`, `title`, `placeholder`, `message`, `description`, `text`, `hint`, `error`, `aria-label`, `aria-valuetext`, and names ending in `Label`, `Hint`, `Title`, `Text`, `Message`, `Placeholder` or `Description`) and the same keys of objects held by a prop, given or spread (`action={{ label }}`, `accessibilityActions={[{ label }]}`); every value of `labels` / `*Labels` objects, label functions with an expression body included; the navigation keys `title`, `headerTitle`, `headerBackTitle`, `tabBarLabel`, `tabBarAccessibilityLabel` and `drawerLabel` anywhere in the file, even as another call's data (`track({ title: 'opened' })`); `Alert.alert` / `Alert.prompt` arguments and the text keys of their objects (button `text`). Text is found directly or through at most 3 nested wrappers (`MAX_NESTING`): `?:` branches, `&&`, `||`, `??`, `+`, templates, array elements (children `{['Hi', t('a')]}`, array-valued props), `as` / `satisfies` and arrow bodies. An object key is matched from the nearest prop or alert call through at most 6 intermediate nodes (`MAX_OBJECT_PATH`) of objects, arrays, spreads, conditionals, logical operands and type assertions; a function or a call ends the path, so a text key inside a callback or a call argument (`onPress={() => track({ label: 'save_button' })}`, `action={makeAction({ label: 'retry_action' })}`) is that code's data and is not reported. Beyond a syntax check: a string stored in a variable first, a label function with a block body, a key computed at run time, a literal behind more than 3 wrappers, an object key more than 6 nodes deep. Test code of these folders (`*.test.ts(x)`, `__tests__/`, `__fixtures__/`) is exempt: it gets a separate layer entry with the same import bans and style guards. The guards live in `tools/eslint/text-guards.mjs` (`TEXT_GUARDS`), their cases in `tools/eslint/layers-text-cases.mjs` with the probes in `tools/eslint/layers-text-probes.mjs`; the `i18next` / `react-i18next` import ban cases are in `tools/eslint/layers-i18n-cases.mjs`, the i18n barrel cases in `tools/eslint/layers-i18n-barrel-cases.mjs`.
- Routes and features never style directly: no `StyleSheet` from `react-native` and no `style` or `*Style` JSX prop given an expression, directly or in an object literal spread as props (a string literal is a mode, as in `<StatusBar style="auto" />`; plain object keys such as navigation `tabBarStyle` stay allowed). They compose `src/ui/` primitives, which take token names only (`padding="lg"`, `surface="surfaceMuted"`, `variant="title"`), never raw values; a new visual need extends a primitive. The guards live in `tools/eslint/syntax-guards.mjs` (`STYLE_GUARDS`).
- Routes and features import `src/ui/` through its public barrel `@ui/index` only: deeper `@ui/...` paths and relative paths into `src/ui/` are rejected, including in `import()` and jest module calls, so internals such as `useThemeColors` (raw color values) stay inside the design system.
- Routes and features (production and test code) and `src/platform/` import `src/core/i18n/` through its public barrel `@core/i18n/index` only (ADR-0011), with the same rule shape (`i18nInternals` in `tools/eslint/import-bans.mjs`, built like `uiInternals`): any other `@core/i18n/...` specifier (`@core/i18n` alone included) and any relative path into `src/core/i18n/` (the barrel included) is rejected, type imports included, in static imports, re-exports, `import()` and jest module calls, so `createI18n`, `resources` and the catalogs stay internal. `src/platform/` imports the barrel as types only. The rest of `src/core/` and `test/` are not restricted. The `i18next` / `react-i18next` ban and this rule both cite ADR-0011 in their lint messages.
- Routes live in the root `app/`. Expo Router uses `src/app/` as the route root whenever it exists, so `src/app/` must never be created.
- Error reporting (ADR-0012): code reports errors through the core `ErrorReporter` port (`captureError(error, { source, tags })`; tags are short non-personal strings), injected by the composition root and implemented by `src/platform/sentry.ts`. ESLint `no-console` applies to every production file of `app/` and `src/` except `src/platform/sentry.ts`, whose reporter writes to the console in development, where Sentry is disabled. Test code is exempt: the console check (§12) is tested by calling `console` on purpose.
- Root layout: `app/_layout.tsx`, the composition root, at module level reads the app env (`readAppEnv(parseAppEnv)`: `src/platform/app-env.ts` reads `extra.env` and the root passes the core parser, since platform imports core types only; an invalid env throws before anything else is created, ADR-0012), initializes Sentry and creates the `ErrorReporter` (`createErrorReporter(initSentry(appEnv))`, `src/platform/sentry.ts`), and creates the app storage (`createStorage`, `src/platform/storage.ts`), the persist options (`createQueryPersister` over that storage, buster `` `${APP_VERSION}+${CACHE_SCHEMA_VERSION}` ``, §6), the catalog provider `monitorCatalogProvider(createJikanCatalogProvider(jikanInstanceFor(appEnv.jikanBaseUrl)), { reporter })` (§3; this is the only place that selects a provider or an instance, so an unset `EXPO_PUBLIC_JIKAN_BASE_URL` selects Tenrai) and the recent searches repository `createLocalRecentSearchesRepository(storage, { maxQueryLength: catalogProvider.searchQueryMaxLength })` (§6); in the component it creates the query client (`useState(createQueryClient)`). Module level, so each is one stable object for its context. Missing translation keys (each key once per language), a missing `Intl.PluralRules` and the ui `ThemeProvider` `onError` prop go through the reporter in every build (Sentry in release, console in development); a key and a language are not personal data. It loads the theme and language preferences synchronously on mount (`loadPreferences`, so the first frame already uses them) into `useState`; the change handlers save the choice, then update the state. It wraps a root `Stack` from `expo-router` in `PersistQueryClientProvider`, then `CatalogContextProvider` (the catalog provider), then `RecentSearchesContextProvider` (the recent searches repository), then `PreferencesProvider` (the preferences and their setters), then `I18nProvider`, then the ui `ThemeProvider`: the data dependencies sit next to the query client, outside the presentation providers, and none of them depends on another's context. The Supabase client (`createSupabaseClient`, §8) is not wired yet: it is wired with its first consumer (the auth or library repositories), from the URL and anon key of the parsed app env. Root stack screens: `(tabs)` without a header; `media/[namespace]/[kind]/[id]` with a translated header title (`t('mediaDetail.title')`); `+not-found` with a translated title. Every root stack screen gets `headerBackButtonDisplayMode: 'minimal'` and `headerBackButtonMenuEnabled: false` (`screenOptions`): the back button would otherwise show the route name of the screen below, the untranslated `(tabs)`, as its title or in the iOS back history menu. It exports `unstable_settings = { initialRouteName: '(tabs)' }`, so a cold deep link to a detail screen still has the tabs below it to go back to.
- Tabs: `app/(tabs)/_layout.tsx` uses `Tabs` from `expo-router/js-tabs` (the `Tabs` export of `expo-router` is deprecated in SDK 57; the unstable native tabs are not used). Five tabs: `index` (Discover, the route `/`; there is no `app/index.tsx`), `search`, `library`, `favorites` and `settings`. Each shows the navigator header with its translated title (`title` and `tabBarLabel` from `t('tabs.<name>')`), has `tabBarButtonTestID: 'tab-<name>'` (`tab-discover`, `tab-search`, `tab-library`, `tab-favorites`, `tab-settings`) and a `tabBarIcon` rendering the ui `TabBarIcon` (`{ icon, focused }`: icon chosen by meaning from `src/ui/components/icons.ts`, filled when focused, `primary` when focused and `textMuted` otherwise, read from the palette inside `src/ui/`). Tab buttons get a selected state from react-navigation, with the role `tab` on Android and `button` on iOS (which announces the position, "Discover, tab, 1 of 5"); icons are hidden from accessibility, so a tab is announced by its translated title.
- Routes are thin and render feature screens (`src/features/<feature>/<Name>Screen.tsx`). `DiscoveryScreen`, `LibraryScreen` and `FavoritesScreen` are placeholders (`Screen` + a translated `EmptyState`), replaced by C-08, L-04 and L-05. `SettingsScreen` holds the theme and language pickers, built on the ui `RadioGroup` (generic over the value type: container role `radiogroup`, each option role `radio` with a `checked` state and a full-size touch target, token classes only) and wired through `usePreferences`. Language options are endonyms, identical in both catalogs ("English", "Français"); only "System" is translated. Screens under a navigator header and above the tab bar inset left and right only (`Screen` `edges`).
- Data dependencies reach hooks through React contexts in `src/core/hooks/`, one per injected dependency, built like the preferences module: `CatalogContext` (`catalog-context.ts`, `createContext<CatalogProvider | null>(null)`), `CatalogContextProvider({ provider, children })` and `useCatalogProvider()`; `RecentSearchesContext`, `RecentSearchesContextProvider({ repository, children })` and `useRecentSearches()`. The components end in `ContextProvider`, so none clashes with the `CatalogProvider` interface. A provider passes the given object as the context value, so the object must be stable (module level in the composition root, one per test); each hook throws outside its provider with a message naming it, like `usePreferences`. One context per dependency rather than one shared object: a hook test wraps only what the hook uses, and the library repository, which changes with the auth state (A-03), will not re-render catalog consumers. Hooks are imported by file (`@core/hooks/use-search`); there is no barrel.
- Search screen (`src/features/search/`, C-04, FR-01, FR-02, BR-06): the screen holds the field text and the kind (`anime` by default; `SearchKindSwitch`, two single-select `Chip`s, Anime and Manga; the other filters are C-05). The field (`Input`) is capped at `useCatalogProvider().searchQueryMaxLength` (`maxLength`), with return key `search` and autocorrect off. The raw text decides what is shown, without delay: when `prepareSearchQuery(text, max)` is `null`, the recent searches (`RecentSearchesList`: a tap puts the entry in the field and searches it, a clear-all action empties the list); otherwise the results. The query sent is `prepareSearchQuery(useDebouncedValue(text, SEARCH_DEBOUNCE_MS), max)`, and the params `{ kind, query, page: 1 }` (memoized, `null` while that query is `null`) go to `useSearch(params, { showAdult: DEFAULT_SHOW_ADULT })` until L-06 wires the setting (`// TODO(L-06)`); a kind change is not debounced. The screen branches on the raw text first, never on `data`: with placeholder data a cleared field could still hold the last results. `SearchResults` shows, in this order of precedence: an `ErrorState` (a `CatalogNetworkError` gives the offline message, any other error a generic one; its action calls `refetch`), a `Spinner` on the first load, an `EmptyState` when no item is left and none was hidden, otherwise a `List` of `SearchResultRow`s, the previous results staying visible with a small spinner while a new key loads (`isPlaceholderData`). When `hiddenCount` is above 0, a subtle translated note (plural) says that adult titles were hidden, also above an empty list. A row (`MediaListItem`, memoized, key `<namespace>:<kind>:<externalId>`) shows the cover, the title, the English title when present and different from the title ignoring case, the translated format, the year and the score (`formatNumber`); pressing it records the search, then opens `router.push({ pathname: '/media/[namespace]/[kind]/[id]', params: toMediaRouteParams(item.key) })`. A search is recorded on submit of the field (the prepared raw text, when not `null`) and when a result is opened (the query of the results shown, kept in a ref), never on a debounced keystroke. A submit or a tapped recent search is searched at once, without waiting for the debounce; typing stays debounced. An unrecognized format shows a translated "Unknown format". Page 1 only: pagination is C-06.
- Deep links and route params: `app/media/[namespace]/[kind]/[id].tsx` (deep link `tsuzuki://media/mal/anime/52991`) passes the raw `useLocalSearchParams()` to `MediaDetailScreen`, which parses them with `parseMediaRouteParams(raw: unknown): MediaKey | null` (`mediaRouteParamsSchema` in `src/core/schemas/media-route-params.ts`). `namespace` must be exactly one of `MEDIA_ID_NAMESPACES` (ADR-0013) and `kind` exactly one of `MEDIA_KINDS`; `id` must be a string of decimal digits without sign, leading zero, space, decimal point or exponent (`^[1-9][0-9]*$`), at most `EXTERNAL_ID_MAX` (the Postgres `integer` bound of `library_entries.external_id`, §5); a missing or repeated (array) value is rejected, other params are ignored. The former two-segment path `media/<kind>/<id>` matches no route and shows the not-found screen; it changed before any release, so no shipped link breaks. Invalid params show a translated `ErrorState` whose action goes back to Discover (`router.dismissTo('/')`: the tabs stay the only entry below, no second Discover; navigation only); valid params show a translated placeholder until C-07. A deep link never triggers a write: the route and the screen call no repository and no mutation. `app/+not-found.tsx` replaces expo-router's untranslated default screen for unmatched links with a translated `ErrorState` and the same action back to Discover.
- Typed routes are off (`experiments.typedRoutes` not set, no `tsconfig.json` change): expo-router generates the route types into `.expo/types` only when `expo start` runs, which CI never does, so `tsc` would check hrefs locally but not in CI. Param safety comes from Zod at the route boundary. To revisit if a later item needs typed hrefs.
- Expo Router API routes (`+api`) are not used: server logic lives in Supabase Edge Functions. `tsuzuki/file-name-case` rejects them, and accepts dotfiles and dot-folders outside `app/` whose name after the leading dot is kebab-case (`.prettierrc.mjs`, `.github/`).
- Path aliases `@core/*`, `@features/*`, `@ui/*` and `@platform/*` map to the four `src/` layers. They are declared in `tsconfig.json` `paths` and resolved natively by Expo's Metro config, with no Babel plugin.
- Dependencies are installed with pnpm in its default isolated mode (no hoisting). pnpm settings, when needed, live in `pnpm-workspace.yaml`; `.npmrc` holds only auth and registry settings.

`src/ui/` components never call i18n: routes and features translate and pass every label (visible text and accessibility labels) as props, as strings or as label functions for computed text (`PaginationLabels.page(n)`). This keeps `ui` independent of `core`.

## 3. Catalog provider adapter

All catalog access goes through one interface, so the Jikan-compatible provider can be replaced or complemented (AniList, MangaUpdates) without touching screens.

```ts
// src/core/catalog/catalog-provider.ts
// MediaKind, MediaIdNamespace, MediaKey ({ namespace, kind, externalId }), the format and status types and
// their const arrays live in src/core/domain/media.ts. a key names whose ids it holds (namespace 'mal' for
// every jikan v4 compatible instance), never the server that returned it (ADR-0013)
import type {
  MediaFormat, MediaIdNamespace, MediaKey, MediaKind, MediaStatus, SearchableMediaStatus,
} from '../domain/media';

export interface Genre {
  readonly id: number;                   // scoped to the provider's namespace (a mal genre id)
  readonly name: string;
}

export interface MediaSummary {
  readonly key: MediaKey;
  readonly title: string;
  readonly titleEnglish: string | null;
  readonly imageUrl: string | null;
  readonly format: MediaFormat;          // tv, movie, manga, manhwa, light_novel… or unknown
  readonly status: MediaStatus;          // ongoing, finished, upcoming, hiatus, discontinued
  readonly totalUnits: number | null;    // episodes or chapters, null when unknown
  readonly score: number | null;
  readonly year: number | null;
  readonly genres: readonly Genre[];
  readonly isAdult: boolean;             // set by the adapter with isAdultMedia (see §7)
}

export interface MediaDetail extends MediaSummary {
  readonly synopsis: string | null;
  readonly titleNative: string | null;
}

export const SEARCH_SORT_FIELDS = ['score', 'popularity', 'title', 'start_date'] as const;
export type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number];
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface SearchParams {
  readonly kind: MediaKind;
  readonly query?: string;
  readonly formats?: readonly MediaFormat[];
  readonly genresIncluded?: readonly number[];
  readonly genresExcluded?: readonly number[];
  readonly status?: SearchableMediaStatus;  // ongoing, finished, upcoming (FR-03)
  readonly year?: number;
  readonly minScore?: number;
  readonly sort?: { readonly field: SearchSortField; readonly direction: SortDirection };
  readonly page: number;                    // 1-based
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly lastPage: number;
  readonly hasNextPage: boolean;
}

export interface CatalogProvider {
  readonly namespace: MediaIdNamespace;  // of every key it returns and accepts; part of every catalog query key
  readonly instanceId: string;           // short non-personal id (tenrai, jikan-self-hosted) for error reports; never a url, never in a key
  readonly searchQueryMaxLength: number; // longest accepted search text, utf-16 code units after trimming
  search(params: SearchParams, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getDetail(key: MediaKey, signal?: AbortSignal): Promise<MediaDetail>;
  getTop(kind: MediaKind, page: number, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getCurrentSeason(page: number, signal?: AbortSignal): Promise<Page<MediaSummary>>;
  getGenres(kind: MediaKind, signal?: AbortSignal): Promise<readonly Genre[]>;
}
```

- `MediaStatus` is the publication status of the title (MAL "On Hiatus" and "Discontinued" included); it never reuses the library status names (`current`, `planned`, `completed`, `paused`, `dropped`, §5).
- The format and status const arrays (`ANIME_FORMATS`, `MANGA_FORMATS`, `MEDIA_FORMATS`, `MEDIA_STATUSES`, `SEARCHABLE_MEDIA_STATUSES`, `SEARCH_SORT_FIELDS`, `SORT_DIRECTIONS`) are the single source for the adapters' `z.enum` schemas and the filter chips (`MEDIA_FORMATS_BY_KIND`). An unrecognized provider type maps to `unknown`.
- The interface file holds types only, no Zod: raw payloads are parsed inside each adapter.
- Media identity (ADR-0013): a `MediaKey` is `{ namespace, kind, externalId }`. The namespace (`MEDIA_ID_NAMESPACES`, today only `mal`) says whose ids `externalId` holds, never which server returned them: Tenrai and a self-hosted Jikan both serve `mal` keys, so switching instance keeps the cache and the library rows. A provider returns keys in its `namespace` only and rejects any other namespace with a `RangeError` before any request. `instanceId` identifies the configured instance in error reports only.
- Search text limit: `searchQueryMaxLength` (a positive safe integer) is the longest search text the provider accepts, in UTF-16 code units after trimming; longer text, and text with a lone surrogate, is a `RangeError` before any request. It is on the interface because routes and features cannot import an adapter: the search field is capped with it, and `prepareSearchQuery` (`src/core/domain/search-query.ts`, §6) cuts and cleans the text with it, so a prepared query is always accepted. The Jikan-compatible adapter exposes `JIKAN_QUERY_MAX_LENGTH` (300, Tenrai's `q` maximum) for every instance.

Adapter rules:

- Raw provider responses are parsed with Zod inside the adapter, then mapped to the normalized types. Nothing provider-specific (field names, GraphQL documents, query parameters, hosts) exists outside the adapter folder: lint rejects `jikan.moe` and `tenrai.org` literals outside `src/core/catalog/jikan/` (`tools/eslint/syntax-guards.mjs`), and the layer zones keep the implementation folders out of everything but `app/_layout.tsx` (§2).
- Every request goes through the provider's `CatalogHttpClient` (`getJson(url, signal?)`, `src/core/catalog/http/`, §6), which rate limits, deduplicates and retries: one client, hence one rate limiter with that instance's own limits, per provider instance, used only by that adapter; the adapter never calls `fetch` itself and passes the caller's `AbortSignal` through. Adapters build deterministic https URLs (stable parameter order, from `normalizeSearchParams` for search), so equivalent requests share one dedup key, parse the body with Zod and map a parse failure to `CatalogResponseError`. The client is GET only: a POST provider (AniList GraphQL) would extend it with a dedup key that includes the body.
- The adapter never filters adult content in requests (ADR-0004).
- Contract suite: every adapter passes `describeCatalogProviderContract(harness)` (`test/core/catalog-provider-contract.ts`, written against the `CatalogProvider` interface only), run once per adapter and per instance: the Jikan-compatible adapter runs it for Tenrai and for a self-hosted instance. The harness creates the provider and serves the adapter's own payloads for the scenarios page, empty-page, detail, genres, adult-genre, adult-rating, server-error, rate-limited, malformed, hanging and foreign-image (a page whose covers are outside the adapter's image allowlist: another host, `http`), and supplies the adapter's predicate telling whether a request carries a content filter and its image hosts (`allowedImageHosts`; the Jikan-compatible harness passes `JIKAN_IMAGE_HOSTS`). Search text limit cases: `searchQueryMaxLength` is a positive safe integer; a query of exactly that many code units is sent (one request); one unit more rejects with a `RangeError` and sends no request. Cover cases (§9): on the page and detail scenarios every `imageUrl` is `null` or equal to `toAllowedImageUrl(imageUrl, allowedImageHosts)`, and at least one is not `null` (the payload has covers); on foreign-image every `imageUrl` is `null`.
- Adding a provider = a new folder next to `jikan/` (added to `CATALOG_ADAPTER_FOLDERS`, `tools/eslint/layers.mjs`), with its own namespace unless it decides a mapping to an existing one, its fixtures, and the contract suite.
- The provider and its instance are selected only in the composition root (`app/_layout.tsx`, §2); hooks and screens see the `CatalogProvider` interface.

Sustained failure reporting (`src/core/catalog/catalog-failure-monitor.ts`, ADR-0013): `monitorCatalogProvider(provider, { reporter, now? })` wraps any `CatalogProvider`, platform-agnostic, with the clock and the `ErrorReporter` injected, and returns its results and errors unchanged. It forwards the provider's fields as they are (`namespace`, `instanceId`, `searchQueryMaxLength`; a test asserts each).

- Counted kinds (`CATALOG_FAILURE_KINDS`, `src/core/errors/catalog-errors.ts`): `server_error` (HTTP 500 or above), `rate_limited` (429), `client_error` (any other non-2xx but 404), `timeout`, `malformed_response`, as the provider surfaces them, after the http client's own retries.
- Ignored, neither counted nor resetting the streak: a 404 (a normal answer for a missing title: gaps in MAL ids, a stale library row, a deep link to a missing id), network errors (an offline device would look like an outage until A-05 brings connectivity), aborts, input `RangeError`s and unknown errors. A success clears the streak. Accepted trade-off: a self-hosted base URL with a wrong path answers only 404s, so the monitor never reports it.
- Sustained = 3 counted failures since the last success, each within 2 minutes of the latest one. Reaching the threshold reports the kind of the failure that reached it, at most once per kind per 30 minutes per instance, and clears the streak.
- The report is `captureError(new CatalogProviderFailureError(kind), { source: 'catalog', tags: { instance: instanceId, kind } })`: the instance id and the kind only, never a URL, query, status code or response text (§9).

Jikan-compatible adapter (`src/core/catalog/jikan/`, C-03, ADR-0013):

- One adapter for every Jikan v4 instance. Instances (`jikan-instances.ts`): `JikanInstance { id, baseUrl, rateLimit }`; `TENRAI_INSTANCE` (id `tenrai`, base `https://api.tenrai.org/v1`, `TENRAI_RATE_LIMIT`) is the default; `selfHostedJikanInstance(baseUrl)` (id `jikan-self-hosted`, `SELF_HOSTED_JIKAN_RATE_LIMIT`); `jikanInstanceFor(baseUrl | undefined)` gives Tenrai for `undefined` and a self-hosted instance for a URL. The composition root passes the optional `jikanBaseUrl` of the parsed app env (`EXPO_PUBLIC_JIKAN_BASE_URL`, §10). The instance id is a fixed constant, never derived from the URL.
- Factory: `createJikanCatalogProvider(instance, options?)` returns a `CatalogProvider` with namespace `mal`, `instanceId` the instance id and `searchQueryMaxLength` `JIKAN_QUERY_MAX_LENGTH`, and builds its own catalog http client from `instance.rateLimit`; `options` are the client options without `rateLimit` (`retry`, `timeoutMs`, `random`, `now`, `wallClock`, for tests). Client errors pass through unchanged. The composition root creates it, wrapped in the failure monitor (§2).
- Endpoints (`jikan-urls.ts`), relative to the instance base URL: `search` → `/anime` or `/manga`; `getDetail` → `/{kind}/{externalId}`; `getTop` → `/top/{kind}`, without type or filter; `getCurrentSeason` → `/seasons/now`, parsed as anime, without the `continuing` parameter (Tenrai still lists titles airing from earlier seasons; whether discovery keeps them is C-08); `getGenres` → `/genres/{kind}`, every category, explicit genres included. Paginated requests end with `page` and `limit=25` (`JIKAN_PAGE_LIMIT`: the public Jikan maximum and Tenrai's default, so every Jikan v4 instance accepts it; Tenrai allows 100). URLs are built as strings, the search text with `encodeURIComponent`, never with `URL` / `URLSearchParams`, whose React Native polyfills are incomplete. Search params go through `normalizeSearchParams`, then are written in a fixed order, absent ones left out: `q`, `type`, `status`, `min_score`, `genres`, `genres_exclude`, `start_date`, `end_date`, `order_by`, `sort`, `page`, `limit`. No content filter is ever sent: no `sfw`, `sfw-strict`, `rating`, `unapproved` or `continuing`, though Tenrai supports `rating` (ADR-0004).
- Search values: status `ongoing` / `finished` / `upcoming` → `airing` / `complete` / `upcoming` for anime, `publishing` / `complete` / `upcoming` for manga; sort `popularity` → `order_by=members` (MAL `popularity` is a rank, 1 the most popular, so `members` keeps the meaning of `asc` / `desc`), the other sort fields by name; `minScore` rounded to two decimals; genre ids comma-separated. Jikan takes one `type` per search: `formats` holds at most one format, which needs a Jikan search type (`light_novel` → `lightnovel`, `one_shot` → `oneshot`, `doujinshi` → `doujin`, the others by name); `oel` and `unknown` have none and are not searchable. `year` Y → `start_date=Y-01-01&end_date=Y-12-31` (`jikanYearRange`, the only place reading a year as dates). Confirmed on Tenrai (2026-10-14): `start_date` bounds the start of airing and `end_date` its end, so Y means "aired entirely within Y" and excludes titles still airing or spanning two years (One Piece, mal 21, airing since 1999-10-20, is missing from `start_date=1999-01-01&end_date=1999-12-31` and listed with `start_date` alone). C-05 decides the meaning of the year filter before exposing it; the mapping is unchanged until then.
- Input guards: each method builds its URL before calling `getJson`, so invalid input throws a `RangeError` before any request; the message holds no value and never the search text. Rejected: an unknown kind, status or sort, a page that is not a positive safe integer, a detail key outside the `mal` namespace, an external id outside 1..`EXTERNAL_ID_MAX`, a genre id that is not a positive safe integer, more than 25 included or more than 25 excluded genre ids (Tenrai's maximum per list), a minimum score outside [0, 10], a year without four digits, several formats or one without a search type, search text longer than 300 UTF-16 code units (Tenrai's `q` maximum), and search text with a lone surrogate (`encodeURIComponent` cannot encode it).
- Parsing (`jikan-schemas.ts`, `jikan-fields.ts`, from the published OpenAPI spec, checked against the recorded Tenrai responses; unknown keys stripped): the whole response fails with `CatalogResponseError` when an item's identity (`mal_id`, an integer in 1..`EXTERNAL_ID_MAX`), default title (the first non-blank `Default` entry of `titles[]`, else the deprecated `title`), status (one of the documented anime or manga statuses; `null` fails) or BR-06 inputs (§7) are wrong, or when the pagination (`last_visible_page`, `has_next_page`) is missing or malformed; the Zod issues are dropped, since they could quote provider text. Display fields never fail a response; a missing or invalid one becomes `null`: English and native titles (`titles[]`, then the deprecated field), synopsis (trimmed, blank is `null`), score (in (0, 10]; Jikan sends 0 or `null` for an unscored title), episode or chapter count (a positive integer within the Postgres `integer` bound of `media_total_units`), year (four digits: anime `year`, then `aired.prop.from.year`; manga `published.prop.from.year`) and cover (§9). A `null` or unrecognized `type` maps to the `unknown` format, and so do `CM` and `PV`; `TV Special` maps to `special`. An id repeated within a page keeps its first item, adult when any copy of the id is adult (BR-06 fails closed); the page's `page` is the requested page and `lastPage` at least 1. A detail response for another `mal_id` than the requested `externalId` fails.
- Genres: an item's `genres` are its `genres`, `explicit_genres`, `themes` and `demographics`, in that order, deduplicated by id (the first wins); `getGenres` deduplicates the same way, in the provider's order. The cover is the first allowed URL among `webp.large_image_url`, `jpg.large_image_url` and `jpg.image_url`.
- Recorded facts (Tenrai, 2026-10-14, `__fixtures__/tenrai/`): response `type` values are capitalized as documented ("TV", "ONA", "Movie", "Manhwa"…); `titles[].type` values include `Default`, `Japanese`, `English`, `Synonym` and language names; no `null` anime status was observed (a `null` still fails the response); every item of search, top, season and detail carries the four genre arrays and, for anime, the `rating` key, so the fail-closed BR-06 inputs (§7) hold; `pagination` has extra keys (`current_page`, `items`), which are stripped.

## 4. Repositories

```ts
export interface LibraryRepository {
  list(filter: LibraryFilter): Promise<LibraryEntry[]>;
  get(key: MediaKey): Promise<LibraryEntry | null>;
  upsert(entry: LibraryEntryInput): Promise<LibraryEntry>;
  remove(key: MediaKey): Promise<void>;
}
```

Two implementations: `supabase/` for signed-in users and `local/` for guests. The active one is chosen by the auth state; hooks do not know which one they use.

Authentication also goes through a repository, so Supabase stays confined to `src/core/repositories/supabase/`:

```ts
export type OAuthProvider = 'google' | 'apple';

export interface AuthSession {
  userId: string;
}

export interface AuthRepository {
  signUp(email: string, password: string): Promise<void>; // sends the confirmation email
  signIn(email: string, password: string): Promise<AuthSession>;
  signInWithOAuth(provider: OAuthProvider): Promise<AuthSession>; // pkce
  resetPassword(email: string): Promise<void>; // sends the recovery email
  updatePassword(newPassword: string): Promise<void>; // submitted by the user after the recovery deep link
  signOut(): Promise<void>;
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void; // returns unsubscribe
  deleteAccount(): Promise<void>; // calls the delete-account edge function
}
```

Implemented in `src/core/repositories/supabase/`. The OAuth browser step (`expo-web-browser`) is mobile-only, so it is injected from `src/platform/` like the storage adapters.

## 5. Data model (Supabase)

The migrations in `supabase/migrations/` are the source of truth; this excerpt shows the design.

```sql
create type public.media_kind as enum ('anime', 'manga');
create type public.media_id_namespace as enum ('mal');  -- whose ids external_id holds (ADR-0013)
create type public.library_status as enum ('current', 'planned', 'completed', 'paused', 'dropped');

-- profiles: one row per auth user
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  preferences jsonb not null default '{}'::jsonb,  -- theme, language, showAdult; shape validated with Zod on read
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_preferences_object_check check (jsonb_typeof(preferences) = 'object'),
  constraint profiles_preferences_size_check check (octet_length(preferences::text) <= 4096)
);

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id_namespace public.media_id_namespace not null,  -- no default: every write names its namespace
  media_kind public.media_kind not null,
  external_id integer not null,  -- the integer type caps it at EXTERNAL_ID_MAX (src/core/domain/media.ts)
  -- per-user snapshot of the media, refreshed when the detail screen is viewed
  media_title text not null,
  media_image_url text,
  media_format text not null,
  media_total_units integer,
  media_is_adult boolean not null default false,
  status public.library_status not null default 'planned',
  progress integer not null default 0,
  score smallint,
  notes text,
  is_favorite boolean not null default false,
  started_at date,
  finished_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_entries_external_id_check check (external_id > 0),
  constraint library_entries_media_title_check check (char_length(media_title) between 1 and 500),
  constraint library_entries_media_image_url_check
    check (media_image_url like 'https://%' and char_length(media_image_url) <= 2048),
  constraint library_entries_media_format_check check (char_length(media_format) between 1 and 32),
  constraint library_entries_media_total_units_check check (media_total_units > 0),
  constraint library_entries_progress_check check (progress >= 0),           -- BR-01 floor only
  constraint library_entries_score_check check (score between 1 and 10),     -- BR-07
  constraint library_entries_notes_check check (char_length(notes) <= 2000), -- BR-07
  constraint library_entries_user_media_key unique (user_id, id_namespace, media_kind, external_id)
);

create index library_entries_user_status_idx on public.library_entries (user_id, status);
create index library_entries_user_updated_idx on public.library_entries (user_id, updated_at desc);
create index library_entries_user_favorite_idx on public.library_entries (user_id) where is_favorite;

-- progress history for future statistics, written by trigger only
create table public.progress_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.library_entries on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  from_progress integer not null,
  to_progress integer not null,
  created_at timestamptz not null default now()
);

create index progress_events_entry_idx on public.progress_events (entry_id);
create index progress_events_user_created_idx on public.progress_events (user_id, created_at desc);
```

- The media snapshot is stored **per user** in `library_entries` instead of a shared `media` table: a shared table writable by clients would let any user alter titles or image URLs seen by everyone.
- Media identity (ADR-0013): a user has at most one entry per `(id_namespace, media_kind, external_id)`, the `MediaKey` of §3. `id_namespace` names whose ids `external_id` holds (today only `mal`), never the server that returned them, so switching catalog instance keeps every row. It has no default. The migration `*_media_id_namespace.sql` renamed `mal_id` to `external_id` (its column grants and check follow; the check is now `library_entries_external_id_check`), added `id_namespace` (a temporary default `'mal'` filled any existing row, then was dropped) and rebuilt `library_entries_user_media_key`. It ran before any user data existed and before any binary read or wrote `library_entries` (A-03), so it needed no data migration and no compatibility step (§10). An AniList adapter adds its own namespace (`anilist`) with a new enum value, unless the AniList item decides a mapping to MAL ids.
- `profiles` has no `username` in v1: no requirement uses it, and a unique username would let callers probe which names exist.
- The only progress check in the database is `progress >= 0`. There is no `progress <= media_total_units` check: BR-01's upper bound is enforced in the domain on user edits, and a snapshot refresh must never fail when the provider total drops below the saved progress. The UI shows progress above total gracefully.
- `updated_at` is set by a `before update` trigger on `profiles` and `library_entries`; client values are overwritten.
- `progress_events` rows are written by an `after update of progress` trigger on `library_entries`, only when the progress value changes. There is no insert trigger: logging an insert or a guest merge would invent history.
- A `profiles` row is created by a trigger on `auth.users` insert, which never reads `raw_user_meta_data` (user-controlled at sign-up). `profiles` has no insert or delete policy.
- Every foreign key to `auth.users` cascades, so deleting the auth user removes the profile, the library entries and the progress events (account deletion, A-06).
- Guest merge (BR-08) goes through a Postgres function (`security invoker`, so RLS applies) doing last-write-wins on a client-provided timestamp, since the `updated_at` trigger overwrites client values. To be finalized in A-04.

### Functions

All functions live in schema `private`, which the API does not expose and on which `anon` and `authenticated` have no usage. Each one sets `search_path = ''`, uses fully qualified names, and has `execute` revoked from `public`, `anon` and `authenticated`. `private.log_progress_event` and `private.handle_new_user` are `security definer`: clients have no insert grant or policy on `progress_events`, and the auth server's role has no grant on `profiles`. `private.set_updated_at` is `security invoker`.

### Row Level Security

One policy per command, `to authenticated` only:

```sql
alter table public.profiles enable row level security;
alter table public.library_entries enable row level security;
alter table public.progress_events enable row level security;

-- no insert or delete policy: created by trigger, removed by cascade
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy library_entries_select_own on public.library_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy library_entries_insert_own on public.library_entries
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy library_entries_update_own on public.library_entries
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy library_entries_delete_own on public.library_entries
  for delete to authenticated using (user_id = (select auth.uid()));

-- read only: rows are written by the progress trigger
create policy progress_events_select_own on public.progress_events
  for select to authenticated using (user_id = (select auth.uid()));
```

### Grants

Least privilege, fail closed:

- `anon` has no grant on any table, sequence or function of the schemas `public` and `private` (extension objects aside), and no policy. The Supabase-managed schemas (`graphql_public`, `extensions`) keep their platform grants.
- Default privileges for role `postgres` in schema `public` revoke tables, sequences and functions from `anon` and `authenticated`, so a future object without explicit grants is unreachable instead of exposed.
- Per-schema default privileges cannot remove the global `PUBLIC` execute on new functions, so every function needs its own `revoke execute`; the pgTAP guard `010-privileges` fails when one is missing.
- `service_role` keeps the Supabase defaults (Edge Functions only).

| Table | `authenticated` |
| --- | --- |
| `profiles` | `select`; `update (preferences)` |
| `library_entries` | `select`, `delete`; `insert` and `update` on every column except `id`, `user_id`, `created_at`, `updated_at`. `id_namespace`, `media_kind` and `external_id` stay writable because PostgREST upserts list every payload column in `DO UPDATE SET` |
| `progress_events` | `select` only |

pgTAP (`supabase/tests/database/`) covers owner CRUD, cross-user denial, anon denial, the constraints (BR-01, BR-07), the media key (namespace required, unknown namespace rejected, one entry per key and user, PostgREST upsert on the key) and the triggers. `000-rls-enabled` and `010-privileges` are lasting guards over every table and function. The generated types `src/core/repositories/supabase/database.types.ts` are committed and regenerated with `pnpm db:types`.

## 6. Caching and performance

| Concern | Implementation |
| --- | --- |
| Query cache | TanStack Query, `createQueryClient` (`src/core/query/query-client.ts`): a new client per call, owned by the composition root, one per test. `staleTime` (`STALE_TIMES`): media detail 24 h, top/season 6 h, search 10 min, genres 7 days, library 0 (always revalidated). `gcTime` 7 days (`PERSISTED_CACHE_MAX_AGE`), so restored queries are not collected right away. Query `retry` is off (`query-client.test.ts`): retries and backoff belong to the catalog http client (see "Rate limiting"), so a request is never retried at two levels; hooks pass the query `signal` to the provider and never set `retry` |
| Persistent cache | `PersistQueryClientProvider` with a hand-written persister (`src/core/query/persister.ts`) over the synchronous core `StorageAdapter` (MMKV on mobile), under the key `query-cache`. Writes are throttled (at most one per second, with the latest state); only queries in `success` status are dehydrated, search queries excepted (`shouldDehydrateQuery` skips keys whose first element is `SEARCH_KEY_ROOT` (`'search'`, `src/core/query/keys.ts`), the root of `queryKeys.search`): every debounced prefix of a typed search would otherwise be stored for 7 days and re-serialized with each write, and search text stays out of the stored cache, the recent searches aside (below); `maxAge` 7 days, equal to `gcTime`; `buster` = `` `${APP_VERSION}+${CACHE_SCHEMA_VERSION}` `` (`APP_VERSION` from `expo-constants`, `CACHE_SCHEMA_VERSION` in `src/core/query/cache-schema-version.ts`), so a new version drops the cache, and so does a bump of `CACHE_SCHEMA_VERSION`, required whenever a persisted query shape changes, because an EAS update keeps the app version. The stored envelope is untrusted: invalid JSON or a wrong envelope is removed and restores as an empty cache (cold start). Never holds secrets (§8). Instant start and offline reading |
| Query keys | Centralized factory `queryKeys` in `src/core/query/keys.ts`, readonly tuples of primitives: `['media', namespace, kind, externalId]`, `['top', namespace, kind, page]`, `['season', namespace, page]`, `['genres', namespace, kind]`, `['library']`, `['library', namespace, kind, externalId]` (prefixed by `['library']`, so invalidating the library covers every entry), and the search key `['search', namespace, kind, query, formats, genresIncluded, genresExcluded, status, year, minScore, sortField, sortDirection, page]`, built from `normalizeSearchParams` (`src/core/catalog/search-params.ts`: trimmed query, sorted deduplicated arrays, absent fields as `null`, page last), so equivalent params share one cache entry. `namespace` is the provider's `MediaIdNamespace` (ADR-0013), never the instance: equivalent servers of one namespace (Tenrai, a self-hosted Jikan) share the cache. `CACHE_SCHEMA_VERSION` was not bumped for the namespaced keys: no catalog query had ever been persisted. Library list keys are added with their hook |
| Rate limiting | Catalog http client (`src/core/catalog/http/`): one `createCatalogHttpClient({ rateLimit, retry?, timeoutMs?, random?, now?, wallClock? })` per provider instance, with its own limiter and dedup map, shared by every request of that provider (no singleton: the adapter factory creates its own client from its instance's policy, and the composition root, which owns the provider, never builds a client itself). `getJson(url, signal?)` resolves the parsed JSON as `unknown`; per call, in this order: a non-https URL is rejected with a `RangeError` before any token or fetch; in-flight dedup by URL; the retry loop, where every attempt, retries included, takes a token (`acquire`), then calls `globalThis.fetch` (read at call time) with `Accept: application/json` and a per-attempt timeout covering headers and body (`REQUEST_TIMEOUT_MS`, 10 s; the fetch and the body read are raced against the attempt signal with `raceAbort`, so the timeout and the caller abort also end a transfer that ignores its signal); a status other than 2xx is a `CatalogHttpError` and its body is never read: the attempt's `AbortController` is aborted once the attempt settles (`finally`), which releases the connection on undici and in browsers (the future web app; React Native's XHR-based fetch buffers the body anyway) and is a no-op for an attempt whose body was already read. Limiter (`createRateLimiter(policy, { now? })` → `{ acquire(signal?), pauseFor(ms) }`, `RateLimitPolicy = { buckets: { capacity, refillIntervalMs }[] }`): token buckets in their integer virtual-scheduling form (GCRA); a request is granted when every bucket allows it, and a bucket grants at most `capacity + floor(W / refillIntervalMs)` requests in any window W. Waiters queue FIFO without priority (prefetches: C-06), with one timer for the head of the queue and none when idle; a queued waiter whose signal aborts leaves without taking a token. `pauseFor` holds every waiter, capped at `MAX_PAUSE_MS` (60 s). Clock (approved design change in C-03, after the C-02 review): the limiter, its pauses and the retry deadline read a monotonic clock, `performance.now()` by default (the injected `now`, which must never decrease, read on each call so fake timers apply), so a wall clock change (NTP step, manual change) never refills a bucket, shortens a pause, moves the deadline or stalls the queue; `Date.now` (`wallClock`) only resolves an HTTP-date `Retry-After`. The C-02 clamp of a backward wall clock jump was removed. Jikan-compatible instances (`src/core/catalog/jikan/jikan-rate-limit.ts`, ADR-0013), one policy per instance: Tenrai (`TENRAI_RATE_LIMIT`), one bucket of 2 tokens refilled one per 750 ms, from its documented 4 req/s and 120 req/min per IP: at most 3 requests in any 1 s window (a 4th needs 1.5 s) and 82 in any 60 s window, 80 per minute sustained, 25 % and 32 % under the limits. A self-hosted Jikan (`SELF_HOSTED_JIKAN_RATE_LIMIT`, formerly `JIKAN_RATE_LIMIT`): a bucket of 2 tokens refilled one per 750 ms and one of 10 tokens refilled one per 1.5 s, from the public Jikan's documented 3 req/s and 60 req/min, the conservative default for an instance whose limits are unknown: at most 3 requests in any 1 s window and 50 in any 60 s window (51 need 61.5 s), 40 per minute sustained, bursts of 2 then one per 750 ms until the 10-token bucket is spent. Reading limits as capacity = refill rate (3 per second, 60 per minute) would allow 6 requests in one second and 120 in one minute. The limiter is per device, while Tenrai counts per IP: every device behind one NAT (carrier-grade NAT on mobile networks, shared Wi-Fi) shares its limits, which no device can see. A 429 pauses the limiter for its `Retry-After` (below), sustained 429s are reported by the failure monitor (§3), and the mitigations beyond that are a shared server-side cache ("Dedicated backend", §11) or a self-hosted instance. Dedup (`in-flight-dedup.ts`): identical in-flight requests (key: the exact URL, GET only, per client) share one operation with its own `AbortController` and a caller count; a caller whose signal aborts rejects at once with `CatalogAbortedError` and detaches; when the last caller aborts, the shared operation (token wait, backoff or fetch) is aborted and dropped, so a later caller starts fresh. Nothing is cached, failures included. Retries (`DEFAULT_RETRY_POLICY`, `retry-policy.ts`): at most 4 attempts (3 retries) on 429, 5xx, network errors and attempt timeouts; never on other 4xx, malformed JSON or aborts. Delay = max(`Retry-After`, backoff); backoff with equal jitter `d/2 + random·d/2`, `d` = 1 s·2^(n−1) capped at 8 s for retry n (0.5–1 s, 1–2 s, 2–4 s); `Retry-After` honoured up to 10 s (a longer one is not retried: the `CatalogHttpError` surfaces with its `retryAfterMs`), parsed by `parseRetryAfter` as delta-seconds or an IMF-fixdate (strict regex + `Date.UTC`, not `Date.parse`, compared with `wallClock`), anything else ignored; no retry is scheduled more than 20 s after the call started (its first token wait included); a scheduled retry then queues for its token at the tail of the FIFO like any request, so under a backlog it is sent later. Every 429, and every 503 with `Retry-After`, pauses the whole limiter (`pauseFor`) for the `Retry-After`, or the backoff without one, so every queued request waits, not only the retried one; the pause applies even when that request is not retried (last attempt, `Retry-After` over 10 s). Worst case before an error surfaces: about 30 s plus the token wait. Abort handling (`abortable.ts`) uses only `aborted` and `addEventListener` / `removeEventListener`: React Native 0.86 polyfills `AbortController` with the `abort-controller` package, without `reason`, `AbortSignal.any` or `AbortSignal.timeout`. Errors are the `CatalogError` classes of `src/core/errors/catalog-errors.ts` (§2, §9) |
| Search | `useSearch(params: SearchParams \| null, { showAdult })` (`src/core/hooks/use-search.ts`): `useQuery` with the key `queryKeys.search(provider.namespace, params)`; when `params` is `null` the query function is TanStack's `skipToken` (the typed form of `enabled: false`) under the key `queryKeys.searchIdle(namespace)` (`['search', namespace, 'idle']`), which no search key can equal (their third element is a kind). The query function passes the query `signal` to `provider.search`, so a request whose key is left (a new debounced text, another kind) is aborted down to the http client; `staleTime: STALE_TIMES.search` (10 min), `gcTime: SEARCH_GC_TIME` (30 min: searches pile up during a session and are not persisted), `placeholderData` keeps the results of the key just before (its hash, kept in a ref after each commit, equals the hash of the last query with data) and is not set on the idle key, so a search typed after a cleared field starts without the results from before the clear, no `retry` option. `select` is `selectFilteredPage(showAdult)` (`filtered-page.ts`): one module-level function per value, so the selection is stable and recomputed only when the data or the setting changes; it returns a `FilteredPage<MediaSummary>`, the page with the visible items and `hiddenCount` (BR-06, §7). The screen debounces the field text with `useDebouncedValue(value, delayMs)` (a timer restarted on each change and cleared on unmount; the first value is returned at once) and `SEARCH_DEBOUNCE_MS` = 400 (FR-01), exported by `use-search.ts`. Page 1 only until C-06 |
| Pagination | One cache entry per `(params, page)`, `placeholderData: keepPreviousData`, prefetch of the next page when idle |
| Adult filter | Applied with `select` on cached data: toggling the setting never refetches. `DEFAULT_SHOW_ADULT` (`false`, `src/core/domain/content-filter.ts`) until L-06 wires the setting |
| Images | `CoverImage` (`src/ui/`) over `expo-image`: `source={{ uri }}` with the catalog item's `imageUrl` exactly, `cachePolicy="memory-disk"`, `contentFit="cover"`, `recyclingKey` = the url (a recycled list cell never flashes the previous cover), a short transition, a 2:3 frame sized by a cover size token (`sizes.ts`), hidden from accessibility (the row's text names the title). A `null` url renders a placeholder frame with a glyph, never an image. It accepts only that url prop: no other source, no url built in the UI (§9) |
| Lists | `List` (`src/ui/`) over FlashList: generic over the item, `items`, `renderItem`, `keyOf`, optional header and empty components, `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="on-drag"` (a row tap works while the keyboard is open). Rows memoized (`React.memo`), stable keys `<namespace>:<kind>:<externalId>` |
| Writes | Optimistic updates; `+1` taps coalesced (500 ms) into one upsert; offline writes queued and replayed |
| Database | Indexes above; select only needed columns; library paginated with `range` |
| Bundle | Hermes, lazy routes, no heavy dependency without justification |

Search text preparation (`src/core/domain/search-query.ts`): `prepareSearchQuery(raw, maxLength)` returns the query sent for a field value, or `null` when there is nothing to search. In this order: lone surrogates are removed (a high surrogate not followed by a low one, a low one not preceded by a high one), by a manual scan of the UTF-16 code units, because Hermes may lack `String.prototype.isWellFormed` / `toWellFormed`; the text is trimmed; it is cut at `maxLength` code units, one unit earlier when the cut would split a surrogate pair; trailing whitespace left by the cut is trimmed; an empty result is `null`. `maxLength` must be a positive safe integer (else a `RangeError`). The result is therefore always accepted by the provider (§3), and preparing it again returns it unchanged.

Recent searches (FR-02): local only, at most `RECENT_SEARCHES_MAX` (10), clearable, for both guests and signed-in users.

- Rules (`src/core/domain/recent-searches.ts`, pure): entries are prepared queries, newest first. `normalizeRecentSearches(list)` keeps the first (newest) of the entries equal ignoring case (`toLowerCase`, not locale-dependent) and caps the list at 10; `addRecentSearch(list, query)` = `normalizeRecentSearches([query, ...list])`, so re-running a search moves it to the top with its newest casing. Queries only: the kind is not recorded, a tap re-runs the text with the selected kind.
- Storage (`src/core/repositories/local/recent-searches-repository.ts`): `createLocalRecentSearchesRepository(storage, { maxQueryLength })` implements `RecentSearchesRepository` over the core `StorageAdapter` (MMKV on mobile), under one key, `recent-searches` (`RECENT_SEARCHES_STORAGE_KEY`), as a JSON array of strings. `load` reads it synchronously; its content is untrusted: invalid JSON or a value that is not an array (Zod) gives an empty list, an entry that is not a string or is not already prepared (`prepareSearchQuery(entry, maxQueryLength) !== entry`: blank, untrimmed, over the provider limit, a lone surrogate) is dropped, then `normalizeRecentSearches` applies. `save` writes the given list, `clear` deletes the key. The composition root passes the provider's `searchQueryMaxLength`.
- Hook: `useRecentSearches()` returns `{ searches, add(query), clear() }`. The state is initialised synchronously from `load` (`useState` initializer), so the first frame shows the list. `add` takes a prepared query, computes `addRecentSearch` from the latest list (not a stale closure), saves it, then sets the state; `clear` clears the repository, then the state. `add` and `clear` are stable. The search screen is the only consumer: the state is per hook instance.
- Privacy: recent searches are personal data. They are never logged and never put in an error or a report tag, and they are purged on sign out with the other local user data (FR-25, A-06, §8). They stay on the device; only the search text sent to the provider leaves it (§9).

## 7. Adult content filter

- Providers are always queried without content filters (ADR-0004).
- The BR-06 classifier `isAdultMedia({ kind, genreNames, isRxRated })` lives in `src/core/domain/content-filter.ts`: a title is adult when its genres include Hentai or Erotica (`ADULT_GENRE_NAMES`, compared trimmed and lowercased), or the anime rating is Rx. Adapters call it to set `isAdult`; no adapter reimplements the rule.
- The Jikan-compatible adapter (every instance, §3) passes the names of all four genre arrays, `genres`, `explicit_genres`, `themes` and `demographics` (MAL lists Hentai and Erotica under `explicit_genres`), and reads an anime rating as Rx when it starts with `Rx`, trimmed and case-insensitive (`Rx - Hentai`). It fails closed: a missing or malformed genre array, or a missing anime `rating` key, fails the whole response with `CatalogResponseError` instead of yielding a non-adult item; a `null` rating is an unrated anime.
- `applyContentFilter(items, showAdult)` in the same file is generic over `{ isAdult: boolean }` (catalog items and library snapshots) and returns `{ items, hiddenCount }`; it is applied in hook `select`. Default `showAdult = false`.
- A filtered page can contain fewer items than the provider page size; the UI shows a subtle note instead of refetching.
- App store rating: 17+ (App Store) / PEGI 18 equivalent (Play). Before exposing the toggle on iOS, check the current App Store Review Guidelines (1.1.4).

## 8. Auth, session and guest mode

- Supabase Auth: email + password (email confirmation required), Google and Apple via OAuth PKCE.
- Supabase client: `createSupabaseClient` (`src/core/repositories/supabase/create-supabase-client.ts`) takes the URL, the anon key and a core `SessionStorage`, and sets `auth.storage` to it with `persistSession`, `autoRefreshToken`, `flowType: 'pkce'` and `detectSessionInUrl: false` (the app parses its own deep links with Zod). The URL and key come from the parsed app env (`EXPO_PUBLIC_SUPABASE_URL`, https only; `EXPO_PUBLIC_SUPABASE_ANON_KEY`, the publishable or legacy anon key, ADR-0012). The composition root creates the client together with its first consumer (auth or library repositories), not before.
- Session storage: `src/platform/secure-session.ts` implements `SessionStorage` over `expo-secure-store`, with `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` (readable only while unlocked, never migrated to another device). A value is split by code point into chunks of at most 2048 UTF-8 bytes (at most 32 chunks, otherwise a `RangeError`) stored under `<key>.<generation>.<index>`, with the generation (0 or 1) the stored header does not point to; then the header `<generation>:<count>` is written last under `<key>` and parsed with Zod; then the chunks no header points to are deleted. The header write is the single switch from the whole old value to the whole new value: a failed or interrupted write leaves the old value readable, never a mix of old and new chunks. A failed chunk deletion is reported through the `ErrorReporter` and not thrown (the value is already whole); the next write or removal deletes the leftovers. A read fails closed (`null`) when the header is missing or invalid or a chunk is missing; a removal deletes the header first. A header in the F-09 format (a bare chunk count, chunks under `<key>.<index>`) is invalid: that session fails closed (the user signs in again) and its chunks are deleted by the next write or removal. Keys are limited to `[A-Za-z0-9_-]`: the dot is reserved for the chunk suffixes, so a key cannot collide with another key's chunk. Calls are serialized per key with a promise queue (`getItem`, `setItem` and `removeItem` on one key run one after another, other keys are independent): an overwrite spans several writes and supabase-js takes no lock, so without the queue a read during an overwrite could see mixed chunks, treat the session as invalid and remove it (silent sign-out). A failed call does not block the next one on its key. The `expo-secure-store` config plugin keeps the secure-store data out of Android auto backup (`configureAndroidBackup`) and requests no Face ID permission.
- MMKV (`src/platform/storage.ts`, one unencrypted instance) holds the preferences and the persisted query cache, never the session: `src/core/repositories/supabase/session-isolation.test.ts` proves that sign-in, an authenticated persisted query, a token refresh and sign-out write no token to the `StorageAdapter`, and that a new client restores the session from `SessionStorage` alone. Leaving MMKV unencrypted is reviewed in R-04.
- Guest mode uses the `local` repositories. On first sign-in, `mergeGuestLibrary()` upserts local entries (most recent `updated_at` wins), then clears the guest store (BR-08).
- Sign out: `queryClient.clear()`, persisted cache and local user data purged, recent searches included (`RecentSearchesRepository.clear`, FR-25).
- Account deletion: `delete-account` Edge Function verifies the caller's JWT, then deletes the auth user with the service role key; cascades remove all rows.

## 9. Security

Baseline: OWASP MASVS L1. Rules are in `CONTRIBUTING.md` §7. Summary:

| Threat | Mitigation |
| --- | --- |
| Reading or writing another user's data | RLS on every table + pgTAP tests in CI |
| Leaked privileged key | Only the anon key ships in the app; service role only in Edge Function secrets; gitleaks in CI |
| Token theft on device | Session in Keychain/Keystore via secure-store |
| Malicious provider payload | Zod parsing at the adapter boundary (§3: identity, default title, status and BR-06 inputs fail the whole response with `CatalogResponseError`, display fields fall back to `null` or `unknown`), rendering as text only. Image URLs (`toAllowedImageUrl`, `src/core/catalog/image-url.ts`) are kept only when https, at most 2048 characters (`IMAGE_URL_MAX_LENGTH`, the database check on `media_image_url`), with a host exactly in the provider allowlist (`JIKAN_IMAGE_HOSTS`: `cdn.myanimelist.net`, for every Jikan-compatible instance, so a configured base URL never widens it), no userinfo, port, fragment, backslash or whitespace, and a path and query from a safe character set (unreserved characters, `/` and percent escapes, a `%` only followed by two hex digits; `=` and `&` in the query); anything else gives `null` (no cover). The checks are plain string rules, not a URL parser: React Native's `URL` polyfill lacks `hostname`, so Jest and the device would read a URL differently. Covers render only through the ui `CoverImage` with the item's `imageUrl` as given (`expo-image` and FlashList are imported only in `src/ui/`, §2); the contract suite proves every adapter returns allowlisted urls or `null` (§3) and the search row test that the image source is exactly the summary's url. Catalog errors never carry the query or provider text: Zod issues are dropped and the adapter's `RangeError` messages hold no value |
| Malicious deep link | Route params validated with Zod at the route boundary (`mediaRouteParamsSchema`: exact namespace and kind, bounded decimal id, arrays rejected); invalid params and unmatched links show a translated error; no write triggered by a link |
| Account takeover | Email confirmation, strong password policy, Supabase rate limits + captcha on auth endpoints |
| Vulnerable dependency | Dependabot alerts, recurring dependency update (M-01), `pnpm audit` (high blocks CI), CodeQL |
| Personal data in logs | No PII logging; `no-console` outside `src/platform/sentry.ts`; Sentry errors only (no tracing, no replay), `sendDefaultPii: false`, disabled in development and without a DSN; `beforeSend` and `beforeBreadcrumb` scrub emails, JWTs, bearer tokens and API keys, auth and cookie headers, request bodies and `request.env`, user fields and notes (structured fields, JSON/JS keys quoted or unquoted with either quote style: `"notes": ...`, `'notes': ...`, `notes: ...`, and free-text `notes=` up to `&` or end of line), and formatted phone numbers (international `+` forms and national numbers in separated groups; dotted digit groups are also replaced, a harmless over-scrub); `ErrorContext` carries non-personal tags only; recent searches stay on the device and are never logged or reported, and search queries are not persisted in the query cache (§6); catalog errors (`src/core/errors/catalog-errors.ts`) carry no URL, query string or search text, no underlying error message and no `cause`, since search text is user input and errors reach Sentry; the catalog failure monitor (§3) reports the instance id (a fixed constant, never the configured URL) and the failure kind only, never a URL, query, status code or response text; EU data region (ADR-0012). Accepted limitations: native crash events do not pass through the JS `beforeSend`; they are covered server side by the Sentry project's Data Scrubber, default scrubbers and IP address storage prevention ("Environment setup (owner)"). Unseparated digit runs are not treated as phone numbers, which would also match ids and timestamps |
| Misconfigured or cleartext backend | Env validated with Zod at build time and again at startup; every env URL is `https:` (the optional catalog base URL `EXPO_PUBLIC_JIKAN_BASE_URL` also has no userinfo, query or fragment), no cleartext exception in the native config; the catalog base URL is build-time only, never switchable remotely (ADR-0013); the catalog http client rejects a non-https URL with a `RangeError` before taking a token or calling `fetch` |
| Third-party catalog provider | The provider sees the IP address and User-Agent of every device and the search text it is sent; Tenrai logs IPs and User-Agents for up to 90 days (its privacy policy). No user id, token, email or library data is sent to it. The privacy policy (R-05) names the provider and this logging; a self-hosted instance or a shared server-side cache (§11) removes the third party |

## 10. Environments and CI/CD

Each app variant (ADR-0012) has one name everywhere: `APP_VARIANT`, `eas.json` build profile, update channel and EAS environment.

| Variant | App id / name | Build profile | Supabase | GitHub Environment | Sentry | Built by |
| --- | --- | --- | --- | --- | --- | --- |
| `development` | `io.github.nidroz.tsuzuki.dev` / Tsuzuki (Dev) | dev client, internal distribution, Android APK | `tsuzuki-staging` | none | off (`__DEV__`), no source map upload | developer: `pnpm exec eas build --profile development --platform android` |
| `preview` | `io.github.nidroz.tsuzuki.preview` / Tsuzuki (Preview) | internal distribution, Android APK | `tsuzuki-staging` | `staging` | on, environment `preview` | `eas-preview.yml` on push to `dev` touching app paths |
| `production` | `io.github.nidroz.tsuzuki` / Tsuzuki | store build (Android app bundle) | `tsuzuki-prod` | `production` | on, environment `production` | `release.yml` on tag `v*` |

- `APP_VARIANT` is set in the `env` of each build profile in `eas.json`, and in `.env.local` for `expo start`. The other variables (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN`, the optional `EXPO_PUBLIC_JIKAN_BASE_URL`, and the secret `SENTRY_AUTH_TOKEN` for `preview` and `production`) live in the EAS environment of the same name; the `development` profile sets `SENTRY_DISABLE_AUTO_UPLOAD=true`. `app.config.ts` validates them with `src/core/schemas/app-env.ts` and passes them in `extra.env`: always on the EAS build worker (`EAS_BUILD=true`), and elsewhere only when `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN` or `EXPO_PUBLIC_JIKAN_BASE_URL` is set (a partial or invalid local env still fails: the catalog URL alone fails on the missing Supabase values). Without any of them, `extra.env` is left out and the app fails closed at startup. `APP_VARIANT` is read on its own: a valid value selects the app id and name even without the other variables, an invalid one fails, a missing one falls back to `development`. The Expo CLI compiles `app.config.ts` but loads its imports with plain Node, which strips TypeScript types (Node >= 22.18) yet resolves no extensionless `.ts` import, so `app.config.ts` first loads `tools/expo/resolve-ts-imports.cjs`, a `node:module` resolve hook (no new dependency). It retries a relative import from a TypeScript file (or the app config) with `.ts` only when the error is a module-not-found (`ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`), rethrows the original error when the retry fails, and forces the `module-typescript` format only for the app config's import graph.
- The EAS CLI (`eas build` in `eas-preview.yml` and `release.yml`, `eas credentials`) also evaluates `app.config.ts` locally, with `EXPO_NO_DOTENV=1` (`.env.local` is ignored) and the profile `env` from `eas.json` only (`APP_VARIANT`), not the EAS environment: the config then picks the variant, hence the app id that selects the credentials, without validating the other variables, which the build worker validates. Because the config reads `APP_VARIANT` on its own, `eas credentials` and a local `eas build` need no env set up. The `EXPO_PUBLIC_*` and `SENTRY_DSN` values of the EAS environment are created with `plaintext` visibility (a `secret` value is readable only inside the cloud build), and the Expo robot token must have access to them. `SENTRY_AUTH_TOKEN` is a `secret` EAS variable, read only by the cloud build.
- Catalog instance (ADR-0013): `EXPO_PUBLIC_JIKAN_BASE_URL` is an optional `plaintext` EAS variable, validated as `jikanBaseUrl` by `src/core/schemas/app-env.ts` (https only, a host, an optional port and path, no query, fragment or userinfo; a trailing slash is stripped; empty counts as absent) and re-parsed at startup. Unset, the app uses Tenrai; set, a self-hosted Jikan at that URL. It is per variant and holds no secret. Switching needs only the EAS value plus a build, or an update published with its environment (`pnpm update:publish <variant>`) when only JavaScript changes, so no store release.
- Versions: `eas.json` sets `cli.appVersionSource: "remote"` and the `production` profile `autoIncrement: true`, so EAS owns the Android `versionCode` (incremented on every production build); the version name stays in `app.config.ts`, written by release-please.
- `pnpm-workspace.yaml` `allowBuilds` denies the `@sentry/cli` install script: the binary comes from its optional platform packages, the script is only a fallback download.
- Every env URL is `https:`. The local `supabase start` stack (Docker) is used only by `pnpm test:rls` and `pnpm db:types`; development builds use the staging project.
- `expo-updates` runs with `runtimeVersion: { policy: 'appVersion' }`; updates are published by hand with `pnpm update:publish <variant>` (`tools/expo/eas-update.mjs`), from a commit carrying the app version of the target binaries. The script runs `eas update --channel <variant> --environment <variant>` and rejects a missing or unknown variant and a `--channel` or `--environment` argument that differs from it, and rejects `--branch` and `--auto`, which would bypass the channel's branch. Off the EAS build worker, `app.config.ts` leaves `extra.env` out when no Supabase or Sentry value is set, so an update exported without its EAS environment would fail closed at startup on every device that downloads it. Running `eas update` or `expo export` directly is not allowed.
- EAS build quota: the Expo account is on the "EAS Free" plan; the current build limits are on expo.dev → Billing. To save builds, `eas-preview.yml` runs only for pushes to `dev` that touch the app, native config, dependency and migration paths listed in the workflow (`paths`), or on manual dispatch; within a run the staging migrations always apply and the preview build runs only when a build path changed.
- Database migrations are applied before the build of the same commit and must stay compatible with the binaries already installed (add columns and tables first, remove them in a later release).

### Branching model

| Branch | Role | Receives | Merge method |
| --- | --- | --- | --- |
| `dev` | Development/integration, deployed to staging; every PR targets it explicitly (`--base dev`) | PRs from `feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`; back-merges from `main` | Squash; merge commit for back-merges from `main` only |
| `main` | Production, always releasable, GitHub default branch | Release PRs from `dev`, hotfix PRs, the release-please PR | Merge commit for release PRs; squash for hotfix and release-please PRs |
| `hotfix/*` | Urgent production fix | Branched from `main`, merged into `main`, then `main` merged back into `dev` | Squash into `main` |
| `release-please--branches--main--components--tsuzuki` | Release PR `chore(main): release X.Y.Z` (version + changelog). release-please puts the component in the branch name even with a single package and `include-component-in-tag: false` | Opened and updated by release-please on `main` | Squash into `main` |

```mermaid
flowchart LR
    PR[PR to dev] --> P[PR policy<br/>base branch + title + commits]
    P --> Q[lint + typecheck + tooling tests]
    Q --> T[unit + component tests + coverage]
    T --> S[RLS tests + gitleaks + audit + CodeQL]
    S --> D[merge dev]
    D --> ST[staging migrations<br/>+ EAS preview build]
    ST --> R[release PR<br/>dev to main]
    R --> RP[release-please PR<br/>on main]
    RP --> TAG[tag vX.Y.Z<br/>+ GitHub release]
    TAG --> PROD[prod migrations<br/>+ production build<br/>submit gated off]
    TAG --> BM[main merged back<br/>into dev]
```

- Both `dev` and `main` are protected by the `protect-main-dev` ruleset: PR only, no direct push, no force push. Required status checks and code scanning results are added by the owner once F-04 is merged into `dev` (see "CI workflows and required checks" and "Repository settings (owner)").
- A release PR from `dev` to `main` also requires the owner's approval and the E2E suite (from R-01). Until then, the owner runs `pnpm test:e2e` locally before merging a release PR.
- JS-only fixes can ship with EAS Update on the matching runtime version; native changes require a store build.

### CI workflows and required checks

- All workflows run on `ubuntu-24.04` and use `pull_request`, never `pull_request_target`.
- `permissions: {}` at workflow level; each job grants only what it needs.
- Checkout with `persist-credentials: false`; concurrency groups; a timeout on every job.
- Third-party actions are pinned by full commit SHA with a version comment.
- Jobs that install dependencies use the local composite action `.github/actions/setup/`: `pnpm install --frozen-lockfile`, pnpm store cached on the lockfile hash.
- Accepted risk: like every `pull_request` workflow, the PR policy checks run the pull request's own copy of `tools/ci/` and `commitlint.config.mjs`, so a PR could weaken its own policy checks. The owner reviews every change to these files; the run has a read-only token and no secrets.

| Workflow | File | Triggers | Jobs |
| --- | --- | --- | --- |
| CI | `ci.yml` | PR to `dev` or `main`; push to `dev` (warms the cache, re-checks the squashed result) | `lint`, `typecheck`, `test`, `tooling`, `rls`, `security` |
| PR policy | `pr-policy.yml` | PR to `dev` or `main`: opened, edited, synchronize, reopened | `base-branch`, `pr-title`, `commits` |
| CodeQL | `codeql.yml` | PR and push to `dev` or `main`; weekly schedule | `codeql (actions)`, `codeql (javascript-typescript)` |
| Release | `release-please.yml` | Push to `main` | release-please (see "Releases") |
| EAS preview | `eas-preview.yml` | Push to `dev` touching the app, native config, dependency and migration paths listed in the workflow (`paths` allowlist); `workflow_dispatch` | `staging` (GitHub Environment `staging`): `supabase link` + `supabase db push` to the staging project on every run (applies only pending migrations, idempotent, no EAS quota); then `tools/ci/eas-preview-scope.mjs` (CLI `tools/ci/check-eas-preview-scope.mjs`) reads `git diff --name-only <before>..<sha>` and runs `eas build --profile preview --platform android --non-interactive --no-wait` only when a build path changed (tests and Markdown ignored). A manual dispatch, or a push whose `before` commit is unusable, builds. A pending run cancelled by the concurrency group can drop changes from that diff, which is why migrations are never gated; a skipped build is harmless because the next app-path push builds the whole current tree |
| Production release | `release.yml` | Push of a tag `v*` | `production` (GitHub Environment `production`, owner approval required): full-history checkout, then fails before any migration or build unless the tag's commit is an ancestor of `origin/main` (`git merge-base --is-ancestor`); then `supabase link` + `supabase db push` to the production project, then `eas build --profile production --platform android --non-interactive --no-wait`; store submission (`eas submit`) only when `vars.STORE_SUBMIT_ENABLED == 'true'` |
| Back-merge | `back-merge.yml` | Push of a tag `v*` | `back-merge`: opens a PR `main` → `dev` with `RELEASE_PLEASE_TOKEN` unless `dev` already contains `main`; the owner merges it with a merge commit |

- The deployment workflows follow the rules above (pinned SHAs, `permissions: {}` with `contents: read` only where checkout needs it, checkout with `persist-credentials: false`, timeouts) and their concurrency groups never cancel a running job, which could stop a migration halfway. They run the Supabase CLI and `eas-cli` locked by the lockfile (`pnpm exec`). Builds are Android only: iOS builds stay off until `vars.IOS_BUILDS_ENABLED == 'true'`, and both repository variables are unset.
- Secrets and variables, per GitHub Environment (`staging` and `production`): secrets `EXPO_TOKEN` (Expo robot access token), `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (of that environment's project); variable `SUPABASE_PROJECT_REF`. `RELEASE_PLEASE_TOKEN` stays a repository secret. `SENTRY_AUTH_TOKEN` is an EAS secret, not a GitHub one: source maps are uploaded by the EAS build.
- Environment protection: `staging` deploys from the branch `dev` only; `production` deploys from tags `v*` only and requires the owner's approval, with "Prevent self-review" off (the owner is the only reviewer).

| Required check | Workflow | Verifies |
| --- | --- | --- |
| `lint` | CI | ESLint (zero warnings) + Prettier check |
| `typecheck` | CI | `tsc --noEmit` |
| `test` | CI | Jest with coverage thresholds |
| `tooling` | CI | `pnpm test:tooling` |
| `rls` | CI | `pnpm exec supabase db start` (database only, Supabase CLI locked by the lockfile), `pnpm test:rls`, then checks that the committed database types match the migrations (`pnpm db:types`, then `git diff --exit-code`), then stop |
| `security` | CI | gitleaks v8.30.1 binary pinned by sha256 over the PR commit range (full history on push to `dev`), then `pnpm audit --audit-level high` |
| `base-branch` | PR policy | `tools/ci/base-branch.mjs`: a PR to `main` must come from this repository and from `dev`, `hotfix/*` or a release-please branch, which is exactly `release-please--branches--main` or `release-please--branches--main--components--<component>` (look-alike names are rejected); work branches (`feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`) and any other branch are rejected. PRs to `dev` are unrestricted |
| `pr-title` | PR policy | commitlint on the PR title with `commitlint.config.mjs`: squash merges use the title as the commit message, and release-please reads it. The job lints `<title> (#<number>)`, the header GitHub gives the squash commit on `dev`, so a title that fits only without the suffix cannot land a header over 100 characters that would block every later release PR's `commits` job (`main..dev`) |
| `commits` | PR policy | commitlint over every PR commit (`--from <base> --to <head>`, full history checkout), single-author rule included, so commits made with `--no-verify` are still caught. Merge commits written by git are exempt only while they carry no co-author trailer |
| `codeql (actions)`, `codeql (javascript-typescript)` | CodeQL | CodeQL analysis, build mode none. Free because the repository is public |

Target state: after F-04 is merged into `dev`, the owner adds the eleven checks above as required status checks (source GitHub Actions) to `protect-main-dev` for both `dev` and `main`, plus the rule "Require code scanning results" (CodeQL: security alerts High or higher, other alerts Errors). Until then the checks run but do not block a merge. The E2E suite becomes a release PR requirement from R-01.

### Releases

release-please (`release-please.yml`) runs on push to `main`. Config: `release-please-config.json` + `.release-please-manifest.json`, release type `node`, tags `vX.Y.Z` without component, `bump-minor-pre-major`, `CHANGELOG.md`; the version is also written into `app.config.ts` through a marker.

1. A release PR from `dev` to `main` is merged with a merge commit.
2. release-please opens or updates `chore(main): release X.Y.Z` on `main`. Hotfixes squashed into `main` feed the same PR.
3. Merging the release-please PR creates the tag `vX.Y.Z` and the GitHub release.
4. After each release or hotfix (a hotfix ships through the next release-please tag), `back-merge.yml` opens a PR from `main` to `dev` on the tag; the owner merges it with a merge commit, so they never diverge.

- `chore` and `docs` commits alone produce no release.
- First release: there is no `v0.1.0` tag, so its changelog covers the whole history of `main`; `chore` and `docs` entries are hidden by default.
- Token: a fine-grained personal access token scoped to this repository only (Contents, Pull requests, Issues: read and write), stored as the Actions secret `RELEASE_PLEASE_TOKEN` (see "Repository settings (owner)"). A PR created with `GITHUB_TOKEN` would not trigger the required checks, and its tag would not trigger `release.yml` and `back-merge.yml`. With the owner's token the release commits keep the single author.
- The release flow needs merge commits on `main` and `dev` and PR-title squash commits; the ruleset and merge settings it depends on are listed in "Repository settings (owner)".

### Dependencies

- No update bot: no Dependabot PRs, no `.github/dependabot.yml`. The repository keeps a single author.
- Dependabot alerts only: the owner turns them on (see "Repository settings (owner)"); Dependabot security updates and version updates stay off.
- Updates are the recurring backlog item M-01, done under the owner's identity. It respects the Expo, Jest, test-renderer and Node pins, and bumps the pinned action SHAs and the gitleaks version and sha256.
- Native modules are added with `pnpm exec expo install`, which picks the version matching the Expo SDK, and M-01 keeps them on that version: `expo-image` (Expo-maintained) and `@shopify/flash-list` (Shopify, in the Expo SDK's version list) since C-04, both imported only in `src/ui/` (§2).
- Between updates, `pnpm audit` (high blocks CI) catches known vulnerable versions; CodeQL scans the code and the workflows.

### Repository settings (owner)

GitHub settings that no file in the repository can enforce. The owner applies them once, in this order:

1. Security: enable Dependabot alerts (Settings → Advanced Security). Alerts only, no Dependabot PRs.
2. Actions (Settings → Actions → General):
   - enable "Require actions to be pinned to a full-length commit SHA";
   - optionally, choose the policy that allows only selected actions: tick "Allow actions created by GitHub" (covers `actions/*` and `github/*`, so the CodeQL action) and list `pnpm/action-setup@*, googleapis/release-please-action@*` as the specified actions;
   - require approval to run workflows for all outside contributors (the repository is public).
3. Now, before the next merge into `dev`: Pull requests (Settings → General): set the default squash commit message to "Pull request title" (title = PR title, body blank) and disable "Allow rebase merging". The current default uses the commit message for a single-commit PR, which bypasses the checked PR title, and a `* <message>` list body can exceed commitlint's `body-max-line-length` (100). Every squash into `dev` from now on is linted again by the first release PR's `commits` job (`main..dev`) and cannot be rewritten.
4. After F-04 is merged into `dev`: add the eleven required checks (source GitHub Actions) and "Require code scanning results" to `protect-main-dev`, for both `dev` and `main` (see "CI workflows and required checks").
5. Before the first release:
   - Ruleset: `protect-main-dev` requires linear history, which blocks the merge commits of release PRs and back-merges. Remove `required_linear_history`, remove `rebase` from the allowed merge methods, and split the ruleset per branch with the merge methods of the branching table: `dev` allows squash and merge (merge only for back-merges from `main`), `main` allows merge, plus squash for hotfixes and the release-please PR. Both rulesets keep the required checks and the code scanning rule of step 4.
   - Secrets: store `RELEASE_PLEASE_TOKEN` as an Actions secret (see "Releases").
   - Tag ruleset (Settings → Rules → Rulesets → New tag ruleset): `protect-release-tags`, enforcement active, target tags matching `v*`; rules "Restrict creations", "Restrict updates", "Restrict deletions" and "Block force pushes"; bypass list: the Repository admin role only (the owner). release-please creates the tags with the owner's token `RELEASE_PLEASE_TOKEN`, so it bypasses the ruleset; nobody else can create, move or delete a `v*` tag, which together with the `main` ancestor check of `release.yml` keeps production deployments on reviewed commits.

### Environment setup (owner)

One-time setup of the services behind the variants, in this order. Values shown as `<...>` are placeholders: real values never go into the repository. `gh secret set` without `--body` prompts for the value, which keeps it out of the shell history.

1. Supabase: create the projects `tsuzuki-staging` and `tsuzuki-prod` in an EU region. Note each project ref (`<staging-ref>`, `<prod-ref>`), database password (`<db-password>`, one per project) and publishable key (`<staging-key>`, `<prod-key>`), and create one access token per project, each scoped to that project only (`<staging-token>`, `<prod-token>`): resource access "Project", permissions Project, Application services and Infrastructure and delivery read-only, Database read and write, Account and organization no access (enough for `supabase link`, which reads the API keys with `api_gateway_keys_read`, and `supabase db push`). Each token is stored only in its protected GitHub Environment.
2. Sentry:
   - create an organization in the EU data region (`https://de.sentry.io/`) with the slug `nidro-team` and a React Native project with the slug `tsuzuki`: exactly the constants `SENTRY_ORGANIZATION`, `SENTRY_PROJECT` and `SENTRY_URL` of `app.config.ts` (or edit those constants to match). They are not secrets;
   - note the DSN (`<dsn>`) and create a personal (user) auth token for source maps (`<sentry-token>`), with the scopes Project read and write and Organization read. Not an organization auth token: it embeds the region url `https://sentry.io` (US), so sentry-cli ignores the configured `https://de.sentry.io/` and the upload fails with "Project not found" for an EU organization;
   - in the project settings (Security & Privacy), turn on "Data Scrubber", "Use Default Scrubbers" and "Prevent Storing of IP Addresses": native crash events bypass the app's `beforeSend` scrubbing (§9), so this server-side scrubbing is their only filter.
3. Expo: create a robot user with a build role and an access token (`<expo-token>`). The robot must have access to the EAS environment variables of step 4, which the CI `eas build` reads. The same token is stored as the secret `EXPO_TOKEN` in both GitHub Environments, `staging` and `production` (step 7).
4. EAS environments. The `EXPO_PUBLIC_*` and `SENTRY_DSN` values ship in the app and are read by `eas build` on the CI runner, so they use `--visibility plaintext`; only the Sentry auth token is `--visibility secret`:

   ```sh
   pnpm exec eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_URL --value https://<staging-ref>.supabase.co --visibility plaintext
   pnpm exec eas env:create --environment development --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <staging-key> --visibility plaintext
   pnpm exec eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<staging-ref>.supabase.co --visibility plaintext
   pnpm exec eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <staging-key> --visibility plaintext
   pnpm exec eas env:create --environment preview --name SENTRY_DSN --value <dsn> --visibility plaintext
   pnpm exec eas env:create --environment preview --name SENTRY_AUTH_TOKEN --value <sentry-token> --visibility secret
   pnpm exec eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<prod-ref>.supabase.co --visibility plaintext
   pnpm exec eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <prod-key> --visibility plaintext
   pnpm exec eas env:create --environment production --name SENTRY_DSN --value <dsn> --visibility plaintext
   pnpm exec eas env:create --environment production --name SENTRY_AUTH_TOKEN --value <sentry-token> --visibility secret
   ```

   `EXPO_PUBLIC_JIKAN_BASE_URL` is not created: unset means Tenrai. To point a variant at a self-hosted Jikan (C-10), create it, then build that variant or publish an update with `pnpm update:publish <variant>`; deleting the variable returns to Tenrai:

   ```sh
   pnpm exec eas env:create --environment <variant> --name EXPO_PUBLIC_JIKAN_BASE_URL --value https://<jikan-host>/v4 --visibility plaintext
   ```

5. Android signing: create the keystore of each app id once, interactively (`--non-interactive` builds cannot create one): `pnpm exec eas credentials --platform android`, for the `development`, `preview` and `production` profiles. No env is needed: like `eas build`, `eas credentials` ignores `.env.local` (`EXPO_NO_DOTENV=1`) and the config takes the app id from the profile's `APP_VARIANT` alone.
6. GitHub Environments (Settings → Environments): `staging`, deployment branches limited to `dev`; `production`, deployment tags limited to `v*`, required reviewer the owner, "Prevent self-review" off.
7. GitHub secrets and variables, for each environment (`staging` with the staging project, `production` with the production project):

   ```sh
   gh secret set EXPO_TOKEN --env staging
   gh secret set SUPABASE_ACCESS_TOKEN --env staging
   gh secret set SUPABASE_DB_PASSWORD --env staging
   gh variable set SUPABASE_PROJECT_REF --env staging --body <staging-ref>
   gh secret set EXPO_TOKEN --env production
   gh secret set SUPABASE_ACCESS_TOKEN --env production
   gh secret set SUPABASE_DB_PASSWORD --env production
   gh variable set SUPABASE_PROJECT_REF --env production --body <prod-ref>
   ```

   At the prompts, enter `<expo-token>` (the same Expo robot token in both environments), then that environment's `<staging-token>` or `<prod-token>` and its project's `<db-password>`. Leave the repository variables `STORE_SUBMIT_ENABLED` and `IOS_BUILDS_ENABLED` unset.
8. Local development: `pnpm exec eas env:pull --environment development` writes `.env.local` (git-ignored); add `APP_VARIANT=development` to it (see `.env.example`). Build and install the development client with `pnpm exec eas build --profile development --platform android`.

## 11. Evolution paths

- **Web version**: Next.js app in a pnpm + Turborepo monorepo. `src/core/` moves to `packages/core` as is; the web app implements its own screens and a web `platform` layer (ADR-0006), e.g. a `LocaleAdapter` over `navigator.languages` and the `languagechange` event (ADR-0011).
- **Dedicated backend**: if Edge Functions are not enough (shared catalog cache, scheduled notifications), Next.js API routes or a dedicated service implement the same repository interfaces over HTTP; Postgres and Supabase Auth stay. A shared server-side catalog cache would also pool the provider's per-IP limits and keep user IPs away from the provider (§6, §9); it is written only by that trusted server (ADR-0009).
- **Fallback providers** (ADR-0013): Tenrai has no SLA and can be discontinued at any time; sustained failures reach Sentry (§3). The fallback is AniList if authorized (C-09 "AniList adapter (pending authorization)"), else a self-hosted Jikan (C-10 "Self-hosted Jikan"), which is one env value (§10). AniList: GraphQL, good manhwa/manhua coverage, its own namespace `anilist` unless C-09 decides a mapping to MAL ids (the AniList cross-reference is deferred to that item); free under $150 per month of revenue and a commercial licence above, so any monetization triggers a review, and the app name must not contain "AniList".
- **More providers**: MangaUpdates (chapter releases) as a new `CatalogProvider` adapter, held to the same contract suite (§3).

## 12. Testing

Rules and thresholds are in `CONTRIBUTING.md` §6; tooling choices in [ADR-0010](./adr/0010-test-tooling.md).

| Scope | Runner | Command | Notes |
| --- | --- | --- | --- |
| `*.test.ts` in `src/core/`, `test/core/` | Jest 29, project `core` | `pnpm test` | Node environment with Node export conditions, the app Babel transform (jest-expo's transform entry) and path aliases, no React Native preset: a React Native import in core fails at runtime as well as in lint. A few ES-module-only MSW dependencies are let through `transformIgnorePatterns`. HTTP mocked with MSW (`msw/node` server started by `test/core/setup.ts`, unhandled requests are errors). The catalog http tests (`src/core/catalog/http/`) serve MSW handlers on `https://catalog.test`, inject `random`, drive the fake clock with `jest.advanceTimersByTimeAsync` and assert that no timer is left after each operation. The Jikan-compatible adapter tests (`src/core/catalog/jikan/`) serve MSW handlers on `https://api.tenrai.org/v1` and on a self-hosted test base URL (`__fixtures__/jikan-handlers.ts`, per-endpoint cases in `__fixtures__/jikan-endpoints.ts`), from TypeScript payload builders in the shape of the published openapi spec (`__fixtures__/jikan-builders.ts`) and from recorded Tenrai responses (`__fixtures__/tenrai/`, trimmed for the repository: at most 3 items per list, synopsis and background replaced by placeholders, no adult titles or covers, no people or organizations; its README says how and when they were recorded), which a test runs through the provider. The catalog provider contract suite (`test/core/catalog-provider-contract.ts`, §3) runs for each adapter and instance, Tenrai and a self-hosted Jikan today. The failure monitor tests wrap a fake `CatalogProvider`, with an injected `now` and a recording `ErrorReporter`. Includes the session isolation proof (`session-isolation.test.ts`, §8): a real supabase-js client against MSW auth and REST handlers, with a recording `StorageAdapter` and an in-memory `SessionStorage` |
| `*.test.tsx` in `src/core/`, `test/core/` | Jest 29, project `core-dom` | `pnpm test` | Core hooks and providers, rendered with `@testing-library/react` (React Native Testing Library is banned in core). jsdom environment with browser export conditions, as a web app resolves core; same Babel transform, MSW ES module exceptions and path aliases as `core`. `test/core/setup-dom.ts`: the fixed clock and console check of `core`, no MSW server; `fetch`, `XMLHttpRequest` and `WebSocket` throw (`test/core/no-network.ts`, shared with the mobile setup), since core hooks reach data through the repository and `CatalogProvider` interfaces, which tests replace: catalog and recent searches hooks render inside a `QueryClientProvider` (a new `createQueryClient()` per test) and the context providers with the `test/core/` fakes; `useSearch` and `useDebouncedValue` tests drive the fake timers |
| `src/features/`, `src/ui/`, `src/platform/`, `test/app/`, `test/mobile/` | Jest 29, project `mobile` | `pnpm test` | jest-expo preset + React Native Testing Library 14. Network globals throw (`test/core/no-network.ts`): features and ui reach data only through hooks, which tests mock. Route tests render the real route modules through an in-memory route map with `renderRouterAsync` (`test/mobile/render-router.ts`), because expo-router's `renderRouter` does not await React Native Testing Library 14's async `render`. `.css` imports map to an empty stub (`test/mobile/css-stub.ts`): NativeWind compiles the stylesheet in Metro only, so `className` is never resolved to styles in Jest. `src/ui/` tests assert the token → class mapping on the host props (`classesOf`), plus behaviour and accessibility; components that read the palette render inside `renderWithTheme`; routes and features render inside `renderWithProviders(element, options?)` (`test/mobile/render-with-providers.tsx`; options `{ language?, catalogProvider?, recentSearchesRepository?, queryClient? }`: a `QueryClientProvider` with a new `createQueryClient()` per render, not persisted; `CatalogContextProvider` with the given provider, by default `createFakeCatalogProvider()`; `RecentSearchesContextProvider` with the given repository, by default an empty `createFakeRecentSearchesRepository()`; `I18nProvider` with the real catalogs, English by default; the light theme), and route tests without the root layout pass the same providers to `renderRouterAsync` as its wrapper (`providersFor(options?)`, one wrapper component per call, so a rerender keeps the same providers and query client). The test doubles live in `test/core/`, which depends on the interfaces only (§2): `createFakeCatalogProvider(overrides?)` (namespace `mal`, instance id `fake`, `searchQueryMaxLength` 300, every method not overridden rejects with an error naming it, so a test states the calls it expects) and `createFakeRecentSearchesRepository(initial?)` (an in-memory list). `List` and `CoverImage` render under the jest-expo preset; any mock or setup FlashList or `expo-image` need under Jest goes in `test/mobile/setup.ts` with a comment saying why, and the `CoverImage` and `SearchResultRow` tests read the image source from the rendered `expo-image` host props. `test/mobile/setup.ts` stubs `react-native-nitro-modules` (react-native-mmkv returns an in-memory instance under Jest but loads Nitro first, whose native module Jest lacks); `test/mobile/shared-mmkv.ts` (`sharedMmkvModule`, used from a `jest.mock` factory) returns one in-memory instance per id, so a test can seed and read the storage the app opened. Route tests in `test/app/` cover the tabs layout, the settings language and theme switch through the real root layout, the media detail route with valid and invalid params, the not-found route, and the catalog wiring of the root layout (`root-layout-catalog.test.tsx`: created once from `TENRAI_INSTANCE` when `EXPO_PUBLIC_JIKAN_BASE_URL` is unset, wrapped by `monitorCatalogProvider`, the search field capped at its limit). The real root layout wires the real catalog provider, so a route test through it never runs a search (network globals throw); search behaviour is tested on `SearchScreen` with the fakes |
| `tools/**/*.test.mjs` | Node built-in test runner (`node:test`) | `pnpm test:tooling` | commitlint config, Jest config tsconfig alias mapping, the app config resolve hook and the update publishing script (`tools/expo/`), layer rule regressions (ESLint Node API), test hygiene rules of the tooling suites (no skipped, focused or todo tests), local ESLint plugin rules, base branch policy and EAS preview scope (`tools/ci/`) |
| `supabase/tests/` | pgTAP | `pnpm test:rls` | `supabase test db` against the local stack; Supabase CLI as a devDependency locked by the lockfile. A guard test asserts RLS is enabled on every table in `public` |
| `e2e/flows/` | Maestro | `pnpm test:e2e` | Development build of the `development` variant (app id `io.github.nidroz.tsuzuki.dev`, §10; Expo Go cannot load the MMKV native module), opened on the project with the dev-client link `tsuzuki://expo-development-client/?url=<metro url>&disableOnboarding=1` (Metro at `127.0.0.1:8081` after `adb reverse`, or `METRO_URL`). The smoke flow waits for the Discover screen and taps the five tab buttons by id (`tab-discover`, `tab-search`, `tab-library`, `tab-favorites`, `tab-settings`), checking each screen, independent of the device language; execution in CI deferred to R-01. Maestro and adb are installed by the developer |

- Tests import Jest APIs from `@jest/globals`; there are no ambient Jest types.
- Each project's `testMatch` is built from one list of root-relative patterns, and `jest.config.mjs` fails when a test file matches no project or more than one. No path segment of a pattern starts with a brace group or another glob special character: on Windows Jest turns the slash before it into a backslash that escapes it and the pattern matches nothing (`src\{ui,core}`), so folder alternatives are spelled out one pattern each (`tools/jest/jest-config-globs.test.mjs`).
- Determinism:
  - `TZ=UTC` is set at the top of `jest.config.mjs`, so workers inherit it.
  - Fake timers are on by default; the shared setup (`test/core/fixed-clock.ts`) resets the clock to `Date.UTC(2026, 0, 1)` before every test, so a test that moves the clock cannot leak into the next.
  - Fake timers also fake `performance.now()`, the monotonic clock of the catalog http client (§6): it starts at 0 at each install, so in every test, moves only when the timers advance and is untouched by `jest.setSystemTime` (`test/core/determinism.test.ts`). Caveat for the `mobile` project: after `jest.useRealTimers()`, React Native's Jest setup stubs `performance.now` with `Date.now`, which is not monotonic.
  - Mocks are restored after each test.
  - Test order is randomized within each file by the global Jest `randomize` option; the seed is printed on each run.
  - Unexpected `console.error` / `console.warn` calls are recorded and fail the test in `afterEach` (throwing inside the console call could be swallowed, e.g. by MSW).
  - The three Jest projects share these rules: `test/core/setup.ts`, `test/core/setup-dom.ts` and `test/mobile/setup.ts` all use `fixed-clock.ts` and `fail-on-console.ts`, and the last two `no-network.ts`.
- `testTimeout` is 60 s, set at the Jest root because Jest 29 reads it only there: the first test of a file that renders a lazily required React Native component (`ScrollView`, the router) loads and instruments it inside the test body, up to about 35 s on a cold cache (every CI run), past the 5 s default; a hung test still fails at 60 s.
- Coverage is collected from `app/` and `src/` (tests, fixtures, mocks, declarations and tool configs such as `tailwind.config.ts` excluded); untested files count as 0 %. Thresholds: global 70 % lines, `src/core/` 90 % lines and branches. Jest errors when a threshold path matches no file, so the `src/core/` threshold group is declared with the first source file in `src/core/`.
- Core tests are split between `core` and `core-dom` by extension (`.ts` / `.tsx`), not by a per-file `@jest-environment` docblock, which would keep the `core` setup: its `msw/node` server does not load under jsdom (browser export conditions resolve `msw/node` to nothing, and jsdom lacks the fetch globals MSW needs). F-06 added `core-dom` and `@testing-library/react` with the first core hook, the i18n provider and `useTranslation`.
- Missing translations are caught by three checks, each covering a case the others miss (ADR-0011):
  - parity: the checker `test/core/i18n-catalog-parity.ts`, applied to the real catalogs by `src/core/i18n/catalogs.test.ts`, requires `fr.json` to have exactly the keys of `en.json`, the same `{{placeholders}}` and every plural category of `Intl.PluralRules` for its language. It is the only check for a key in `en.json` but not in `fr.json`: that key resolves through the `en` fallback, so typecheck and the runtime handler never see it;
  - typecheck: keys are typed from `en.json`, so a key absent from it fails;
  - runtime: `onMissingKey` reports a key found in no catalog (built at run time or cast). `renderWithProviders` / `providersFor` (`test/mobile/render-with-providers.tsx`) render routes and features in `I18nProvider` with the real catalogs, English by default, and an `onMissingKey` that fails the test (it logs a `console.error`, which the console check turns into a failure; a throw would abort the render and leak listeners into the next test). The composition root reports them through the `ErrorReporter` (console in development, Sentry in release), and an unexpected `console.warn` fails a test rendering the root layout.
