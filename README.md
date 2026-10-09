# Tsuzuki

> 続き — *"what comes next"*

Tsuzuki is a mobile app (Android + iOS) to track anime, manga, manhwa and manhua. Search the catalog, add titles to your library, and bump your progress with a single tap.

## Features (MVP)

- Search with filters (type, genres, status, year, score, sort) and interactive pagination
- Title details (synopsis, genres, status, episode/chapter count)
- Personal library with statuses: Watching/Reading, Planned, Completed, On hold, Dropped
- One-tap `+1` progress, personal score, notes
- Favorites
- Discovery: top titles, current season
- Guest mode (local only), then account + multi-device sync
- Adult content filter (hidden by default)
- Light / dark theme, English + French UI

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Expo (managed) + Expo Router, TypeScript strict |
| UI | NativeWind, isolated in `src/ui/` |
| Server state | TanStack Query (persisted cache) |
| Local state / storage | Zustand + MMKV, `expo-secure-store` for the session |
| Backend | Supabase (Auth, Postgres, RLS, Edge Functions) |
| Catalog data | Jikan v4 behind a `CatalogProvider` adapter |
| Validation | Zod |
| Tests | Jest, React Native Testing Library, MSW, pgTAP, Maestro |
| CI/CD | GitHub Actions + EAS Build / Submit / Update |

## Getting started

```bash
# prerequisites: Node 22.22.1+ (see .nvmrc), Corepack, Docker (local Supabase)
# the Supabase and EAS CLIs are dev dependencies locked by the lockfile: run them with
# `pnpm exec supabase` and `pnpm exec eas` (no global install)
corepack enable                   # provides the pnpm version pinned in package.json
pnpm install
cp .env.example .env.local        # fill in the Supabase URL and anon key (from F-10)
pnpm exec supabase start          # local Supabase stack (Docker)
pnpm exec supabase db reset       # apply migrations + seed (from F-08)
pnpm start                        # Expo dev server
```

### Development build

The app uses native modules (MMKV, secure storage) that Expo Go does not include: it runs in a development build of its own, built in the cloud by EAS (no Android SDK needed).

One-time setup:

```bash
pnpm exec eas login               # sign in with your Expo account
pnpm exec eas init                # creates the EAS project and prints its id
```

`app.config.ts` is dynamic, so `eas init` cannot write the id there: paste the printed project id into `EAS_PROJECT_ID` in `app.config.ts`.

Build and install:

```bash
pnpm exec eas build --profile development --platform android
```

1. When the build finishes, open its link (or scan the QR code of the build page) on the phone.
2. Allow installing apps from this source when Android asks, then install the APK.
3. Run `pnpm start` and open the project from the development build (scan the QR code printed in the terminal).

JavaScript changes reload from Metro without a new build. Rebuild only when native code or native config changes: after adding a native dependency, or editing a config plugin or the native settings of `app.config.ts`. EAS cloud builds count against a monthly free-tier quota.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm start` | Start the Expo dev server |
| `pnpm lint` / `pnpm lint:fix` | ESLint (zero warnings) / with auto-fix |
| `pnpm format` / `pnpm format:check` | Prettier: format / verify formatting |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Jest unit + component tests with coverage thresholds |
| `pnpm test:tooling` | Tests of the repository tooling (commitlint rule, lint layer rules, local ESLint plugin), Node test runner |
| `pnpm test:rls` | Row Level Security tests (pgTAP), against the local stack started with `pnpm exec supabase start` |
| `pnpm test:e2e` | Maestro end-to-end flows (see [`e2e/README.md`](./e2e/README.md)) |
| `pnpm check` | Lint + format check + typecheck + Jest tests + tooling tests |

CI runs `pnpm check` and additionally RLS tests, gitleaks, `pnpm audit` and CodeQL.

Git hooks (husky, installed by `pnpm install`): `pre-commit` lints and formats staged files, `commit-msg` checks the message against Conventional Commits and the single-author rule (`commitlint.config.mjs`). Git clients outside a terminal need `node` on their `PATH` for the hooks to run.

## Documentation

- [`SPEC.md`](./SPEC.md): product specification
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): architecture, data model, caching, security
- [`docs/adr/`](./docs/adr): architecture decision records
- [`docs/BACKLOG.md`](./docs/BACKLOG.md): roadmap and current tasks
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): engineering rules, git workflow, Definition of Done

## Branching

- `main`: production and default branch, updated only through release PRs from `dev` (or `hotfix/*`).
- `dev`: development and integration, deployed to staging.
- Work branches (`feat/*`, `fix/*`, `chore/*`, `docs/*`, `test/*`) start from `dev` and open PRs against `dev` (`gh pr create --base dev`).

## Data sources

Catalog data comes from [Jikan](https://jikan.moe), an unofficial MyAnimeList API. Tsuzuki is not affiliated with MyAnimeList.

## License

[MIT](./LICENSE)
