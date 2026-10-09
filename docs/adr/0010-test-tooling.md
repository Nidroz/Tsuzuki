# ADR-0010: Test tooling split by runtime

- Status: Accepted
- Date: 2026-09-28
- Amended: 2026-10-09. E2E flows run against the EAS development build instead of Expo Go since F-09 (Expo Go cannot load the MMKV native module), and target the development variant's app id `io.github.nidroz.tsuzuki.dev` since F-10 (ADR-0012).

## Context

F-03 sets up testing. The code runs in three different runtimes: `src/core/` is platform-agnostic TypeScript that must stay free of React Native (ADR-0006), `src/features/`, `src/ui/`, `src/platform/` and `app/` run on React Native, and the repository tooling (`eslint.config.mjs`, `commitlint.config.mjs`) is native ESM run by Node. A single jest-expo project would load the React Native preset for core tests, hiding accidental React Native imports and blocking `msw/node`, whose package exports reject the `react-native` condition. Expo Router also treats every `.tsx` file under `app/` as a route, so route tests cannot live next to routes.

Options considered:

- One Jest project with the jest-expo preset for everything: simplest config, but core tests run with React Native resolution and MSW cannot load.
- Jest projects by runtime, plus Jest for tooling tests: tooling configs use `.mjs` and `import.meta.dirname`, which Jest 29 only loads with experimental VM modules.
- Jest projects by runtime, plus Node's built-in test runner for tooling: two runners, but each one runs code the way it runs in production.
- Vitest for core: faster and ESM-native, but a second transform pipeline next to Metro/Babel and no fit with the Expo test stack.

## Decision

- **Jest 29**, the version the Expo SDK 57 / React Native 0.86 test stack depends on (jest-expo 57, `@react-native/jest-preset` 0.86), with three projects:
  - `core`: `src/core/**` and `test/core/**`. Node environment with Node export conditions, the app's Babel transform (jest-expo's transform entry) and path aliases, no React Native preset; a few ES-module-only MSW dependencies are let through `transformIgnorePatterns`. HTTP is mocked with MSW (`msw/node`, `onUnhandledRequest: 'error'`).
  - `mobile`: jest-expo preset and React Native Testing Library 14 for `src/features/`, `src/ui/`, `src/platform/`, `test/app/` and `test/mobile/`. Network globals throw; features and ui are tested with mocked hooks. Route tests render the real route modules through an in-memory route map with `renderRouterAsync`, since expo-router's `renderRouter` does not await React Native Testing Library 14's async `render`.
  - `core-dom`: the `.test.tsx` files of `src/core/**` and `test/core/**`. Core hooks are tested with `@testing-library/react` in a jsdom environment, starting with the first core hook (F-06, the i18n provider).
- Tests import from `@jest/globals`; no ambient `@types/jest`.
- Determinism is enforced by config and setup: `TZ=UTC` set at the top of `jest.config.mjs` (inherited by workers); global fake timers, with the shared setup resetting the clock to `Date.UTC(2026, 0, 1)` before every test so a moved clock cannot leak; unhandled requests rejected; mocks restored after each test; test order randomized within each file by the global Jest option, seed printed on each run; unexpected console errors and warnings recorded and failing the test in `afterEach`, since a throw inside the console call can be swallowed (e.g. by MSW).
- **Coverage** is collected from `app/` and `src/`, excluding tests, fixtures, mocks and declarations; untested files count as 0 %. Thresholds: global 70 % lines, `src/core/` 90 % lines and branches. Since Jest errors when a threshold path matches no file, the `src/core/` group is declared as soon as `src/core/` contains a source file.
- **Tooling tests** (`tools/**/*.test.mjs`) run on Node's built-in test runner (`node:test`) via `pnpm test:tooling`, calling ESLint and commitlint exactly as the git hooks do.
- **Folders**:
  - `test/core/` (core setup, MSW server factory, determinism tests; same lint bans as `src/core/`), `test/app/` (route tests), `test/mobile/` (mobile setup and its tests, `renderRouterAsync` helper).
  - `tools/commitlint/` (commitlint config tests), `tools/eslint/` (layer rule regression tests through the ESLint Node API; the layer tables split planned in F-05 also go here), `tools/eslint/plugin/` (local rules `backlog-reference` and `file-name-case`).
- **Database**: `pnpm test:rls` runs `supabase test db` (pgTAP in `supabase/tests/`) against the local stack. The Supabase CLI is a devDependency locked by the lockfile, not a global install. A guard test asserts every table in `public` has RLS enabled.
- **E2E**: Maestro flows in `e2e/flows/`, run with `pnpm test:e2e` against Expo Go, then a development build from F-09. Maestro and adb are installed by the developer, not by pnpm.

## Consequences

- Core purity is checked twice: lint rejects React Native imports, and the `core` project fails at runtime if one slips through. Core tests stay reusable when `src/core/` moves to `packages/core` for the web app.
- Two runners (Jest and `node:test`) to maintain; tooling tests are not part of Jest coverage.
- `test-renderer` stays on 1.2.x until the Expo SDK moves to React 19.3.
- The Supabase CLI version is locked with the other dependencies, so local and CI pgTAP runs use the same binary; the recurring dependency update (M-01) updates it.
- Maestro is an external install and is not versioned with the repository.
- Moving to a newer Jest waits for the Expo test stack.
