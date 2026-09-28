# Contributing — Tsuzuki engineering rules

These rules apply to every change. They are not suggestions: when a rule blocks you, stop and ask instead of working around it.

Read first: `SPEC.md` (what we build), `docs/ARCHITECTURE.md` (how), `docs/BACKLOG.md` (what's next), `docs/adr/` (why).

## 1. Language

- Everything in the repository is in **English**: code, identifiers, comments, commit messages, PR titles and descriptions, issues, docs, ADRs.
- Code comments start with a **lowercase** letter: `// retry once on 429`.
- The only non-English content is the French UI translation in `src/core/i18n/`.

## 2. Git

- The repository has **one contributor: the owner**. Commits use the owner's git identity (`git config user.name/user.email`); never change it.
- Single author: no `Co-authored-by` trailer and no tool-generated footer in commits or PRs. A `commit-msg` hook rejects them.
- Branches (see `docs/ARCHITECTURE.md` §10): `main` = production and GitHub default branch, `dev` = development/integration, both protected. Work branches start from `dev` and target `dev`: `feat/<scope>-<short-name>`, `fix/…`, `chore/…`, `docs/…`, `test/…`. Only `hotfix/*` branches start from `main`.
- Because `main` is the default branch, every PR must set its base explicitly: `gh pr create --base dev` (or `--base main` for hotfixes only). A feature PR targeting `main` is a blocker.
- Conventional Commits, enforced by commitlint: `feat(library): add +1 progress button`.
- Small, focused commits. Never commit generated files, secrets or `.env*` files (except `.env.example`).
- Never `git push --force`, never push to `dev` or `main`, never merge. The owner pushes, opens and merges PRs unless explicitly told otherwise.

## 3. Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install dependencies (pnpm only, lockfile committed) |
| `pnpm start` | Expo dev server |
| `pnpm lint` / `pnpm lint:fix` | ESLint, zero warnings allowed |
| `pnpm format` / `pnpm format:check` | Prettier: format / verify formatting (Markdown is not formatted) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Jest unit + component tests with coverage thresholds |
| `pnpm test:rls` | pgTAP tests for RLS policies (needs `supabase start`) |
| `pnpm test:e2e` | Maestro flows |
| `pnpm check` | lint + format check + typecheck + unit/component tests, as far as they exist (see below) — run before declaring any task done |
| `supabase migration new <name>` | Create a migration (never edit an applied one) |

`pnpm check` grows with the backlog and never contains placeholder scripts: F-01 runs typecheck, F-02 adds lint and the format check, F-03 adds tests. CI runs `pnpm check` and additionally RLS tests, gitleaks, `pnpm audit` and CodeQL.

## 4. Project structure and layers

```
app/            expo-router routes only: thin screens composing features
src/features/   mobile screen logic per feature (search, discovery, library, media-detail, favorites, auth, settings)
src/ui/         design system: theme tokens + primitive components. only place allowed to use NativeWind
src/core/       platform-agnostic TypeScript: domain, schemas, catalog providers, repositories, hooks, i18n
src/platform/   mobile-only adapters: MMKV storage, secure session storage, Sentry
supabase/       migrations, edge functions, RLS tests
e2e/            Maestro flows
```

Dependency direction (enforced by `import-x/no-restricted-paths`):

```
app → features → ui, core, platform
ui → (nothing but theme)
core → (no react-native, no expo-*, no nativewind, no platform)
platform → core (interfaces only)
```

- `src/core/` must stay shareable with a future Next.js app: React and TanStack Query are allowed, React Native is not.
- Routes, features and UI components never import Supabase or a catalog provider directly; routes and features use hooks from `src/core/hooks/`, which depend on repository and `CatalogProvider` interfaces, never on their implementations.
- Supabase client is imported only in `src/core/repositories/supabase/`.
- Jikan is imported only in `src/core/catalog/jikan/`.
- Only the root layout `app/_layout.tsx` (composition root) wires the repository and catalog provider implementations (`supabase/`, `local/`, `jikan/`); routes, features and UI components (`app/`, `src/features/`, `src/ui/`) have no direct network access (`fetch`, `XMLHttpRequest`, `WebSocket`, `expo/fetch`, Expo internals): network goes through `src/core/` and `src/platform/` (mobile SDKs).

### Root configuration ownership

Root configuration files belong to the area they configure. A change to one of them is reviewed with that area's rules.

| Area | Files |
| --- | --- |
| App and tooling | `package.json`, `tsconfig.json`, `app.config.ts`, `babel.config.js`, `metro.config.js`, `.npmrc`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitattributes`, `eas.json`, ESLint and Prettier config, husky and commitlint config, `.github/workflows/` |
| Testing | Jest config and setup, MSW handlers setup, Maestro config |
| Database | `supabase/config.toml` |

## 5. Code standards

- TypeScript `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. No `any`, no non-null `!`, no `@ts-ignore` / `@ts-expect-error` without a backlog ID: `// @ts-expect-error(F-05): upstream type is wrong`.
- Every external input is parsed with Zod at the boundary (provider responses, Supabase rows, deep link params, forms). Inside the app, types are trusted.
- Domain logic (business rules BR-xx from `SPEC.md`) lives in pure functions in `src/core/domain/`, never in components.
- Functional components + hooks only. No default exports except where expo-router requires them.
- Naming: `PascalCase` components/types, `camelCase` functions/variables, `kebab-case` files except components (`MediaCard.tsx`).
- No magic numbers or strings: constants in the module that owns them, theme values in `src/ui/theme/`.
- No hard-coded user-facing strings: always `t('key')`.
- Errors: typed error classes in `src/core/errors/`; never swallow an error silently; user-facing errors are translated.
- Keep files under ~300 lines; split when they grow.
- A `TODO` must reference a backlog ID from `docs/BACKLOG.md`: `// TODO(F-05): handle season rollover`. If no backlog item fits, add one first: a TODO never points to nothing.

## 6. Testing (blocking in CI)

| Layer | Tool | Rule |
| --- | --- | --- |
| `src/core/` | Jest | ≥ 90 % lines and branches; every BR-xx has explicit tests |
| Global | Jest | ≥ 70 % lines |
| `src/ui/` + feature screens | React Native Testing Library | Every component and screen has a test (render, interaction, a11y label) |
| Catalog providers | MSW + recorded fixtures | Success, empty, 429, timeout, malformed payload |
| Database | pgTAP | For each table: owner can CRUD own rows, cannot read/write others' rows, anon has no access |
| E2E | Maestro | search → add → +1 → favorite; sign in; guest → account merge |

- Write the test with the code, in the same PR. A bug fix starts with a failing test.
- Tests are deterministic: no real network, no real time (fake timers), no order dependency.
- Never lower a threshold or skip a test to make CI pass.

## 7. Security (non-negotiable)

- RLS enabled on every table, with policies and pgTAP tests in the same migration PR.
- Only the Supabase **anon** key in the app. The `service_role` key exists only in Edge Function secrets.
- No secret in code, config or git history. Env vars via `app.config.ts` + EAS secrets; `.env.local` is git-ignored.
- Session stored with `expo-secure-store`, never in MMKV or AsyncStorage.
- OAuth with PKCE. Deep link parameters validated with Zod; a deep link never triggers a write by itself.
- Never log tokens, emails, notes or any personal data. Sentry `beforeSend` scrubs them.
- HTTPS only. Images loaded from provider CDNs only.
- New dependency = justify it in the PR (maintenance, size, license, security). Prefer Expo-maintained packages.
- Review checklist: OWASP MASVS L1.

## 8. Definition of Done

A task is done only when all of these are true:

1. Acceptance criteria from the backlog item are met.
2. `pnpm check` passes locally with the checks that exist at that point (see §3); RLS tests pass if the schema changed.
3. Tests added/updated per §6.
4. Docs updated: `ARCHITECTURE.md`, a new ADR if a structural decision was made, backlog item ticked.
5. Code review approved.
6. The owner validated.

## 9. Workflow

- One backlog item = one branch = one PR.
- Before coding: restate the task, list files to touch, list tests to write.
