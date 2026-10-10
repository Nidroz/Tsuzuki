# ADR-0012: Environments, app variants and error reporting

- Status: Proposed
- Date: 2026-10-09

## Context

F-10 connects the app to real backends and ships builds outside the developer's machine. It needs:

- build-time configuration (Supabase URL and key, Sentry DSN) that is validated, never committed, and identical in shape for every build;
- several builds of the app on one device (development, internal preview, production) without one overwriting another's data or session;
- EAS build profiles, update channels and EAS environments that match the GitHub environments of `ARCHITECTURE.md` §10;
- crash and error reporting that never sends personal data (`CONTRIBUTING.md` §7);
- `src/core/` free of React Native and Expo (ADR-0006), so configuration parsing and error reporting cannot depend on `expo-constants` or `@sentry/react-native` there.

Options considered, configuration source:

- **`EXPO_PUBLIC_*` variables read directly in code**: inlined by Metro at bundle time, simple, but read at every call site without a single validation point, and a typo gives `undefined` at run time.
- **`app.config.ts` reads the env at build time, validates it and passes it in `extra.env`; the app re-parses it at startup**: one schema, the build fails on a wrong value, and the app never trusts the native manifest blindly.
- **Fetch the configuration at run time from a server**: needs a backend before the backend client exists; rejected.

Options considered, variants:

- **One app id for every build**: a preview build replaces the production install and shares its secure store.
- **One app id per variant, chosen by `APP_VARIANT`**: the variants install side by side, each with its own storage and keychain.

Options considered, local backend for the app:

- **Development builds against the local `supabase start` stack**: needs cleartext HTTP to the developer machine, so a cleartext exception in the native config.
- **Development builds against the staging project**: HTTPS everywhere, no cleartext exception; the local stack stays for pgTAP and database types.

Options considered, error reporting:

- **Sentry (`@sentry/react-native`)**: maintained, Expo config plugin and Metro integration for source maps, EU data region available, free tier sufficient.
- **Expo's own tooling or a custom endpoint**: no symbolication service, more code to maintain.

## Decision

### Configuration

- `app.config.ts` reads at build time `APP_VARIANT`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the Supabase publishable key, or the legacy anon key) and the optional `SENTRY_DSN`, validates them with the core Zod schema `src/core/schemas/app-env.ts`, and passes the result in `extra.env`. An invalid value fails the build or `expo start`.
- The Expo CLI compiles `app.config.ts` itself but loads its imports with plain Node, which strips TypeScript types natively (Node >= 22.18) and resolves no extensionless `.ts` import. `app.config.ts` therefore loads `tools/expo/resolve-ts-imports.cjs` first: a resolve hook registered with `node:module` `registerHooks` that retries a failed relative import from a TypeScript file with the `.ts` extension. No new dependency (a TypeScript loader package was not needed); the hook is tested with the tooling tests.
- At startup, `src/platform/app-env.ts` `readAppEnv(parse)` reads `extra.env` through `expo-constants` and re-parses it with the same schema: the native manifest is an input like any other. `src/platform/` imports core types only, so the composition root passes the core `parseAppEnv`. An invalid env throws before any client is created.
- Every URL of the env is `https:`: there is no cleartext exception in the native config. Development builds point at the staging Supabase project; the local `supabase start` stack is used only by tests (`pnpm test:rls`, `pnpm db:types`). An empty `SENTRY_DSN` counts as absent.
- `.env.example` lists the variables with placeholders; `.env.local` (git-ignored) holds the developer's values, pulled with `pnpm exec eas env:pull`. Values for builds live in EAS environments, never in git. The Supabase key and the Sentry DSN ship in the app by design; they are not secrets. The `service_role` key never appears in the env.

### App variants

| `APP_VARIANT` | App id (Android package, iOS bundle id) | Name | Supabase |
| --- | --- | --- | --- |
| `development` | `io.github.nidroz.tsuzuki.dev` | Tsuzuki (Dev) | staging |
| `preview` | `io.github.nidroz.tsuzuki.preview` | Tsuzuki (Preview) | staging |
| `production` | `io.github.nidroz.tsuzuki` | Tsuzuki | production |

`APP_VARIANT` is set in the `env` of each `eas.json` build profile (versioned, so a profile cannot build the wrong app id) and in `.env.local` for `expo start`. The Maestro flows target the development app id `io.github.nidroz.tsuzuki.dev`.

### EAS profiles, channels and updates

- `eas.json` has the build profiles `development` (dev client, internal distribution, Android APK), `preview` (internal distribution) and `production` (store), with the channels `development`, `preview` and `production` and `environment` set to the EAS environment of the same name.
- `expo-updates` is configured with `runtimeVersion: { policy: 'appVersion' }`: an update reaches only binaries of the same app version. No workflow publishes updates; an update is published by hand (`pnpm exec eas update --channel <channel>`).
- Versions: `cli.appVersionSource` is `remote` and the `production` profile sets `autoIncrement: true`, so EAS owns the Android `versionCode` and increments it on every production build; the version name stays in `app.config.ts`, written by release-please.
- The CI workflows run `eas build` on the GitHub runner, which evaluates `app.config.ts` there: the `EXPO_PUBLIC_*` and `SENTRY_DSN` variables of the profile's EAS environment are created with `plaintext` visibility (they ship in the app anyway), and the Expo robot token used by CI must have access to them. `SENTRY_AUTH_TOKEN` is a `secret` EAS variable, read only inside the cloud build.

### Error reporting

- `src/core/errors/error-reporter.ts` defines the `ErrorReporter` port: `captureError(error, context?)`, where the context holds a `source` and non-personal string tags only. `src/platform/sentry.ts` implements it with `@sentry/react-native` 7.11 (`initSentry`, `isSentryEnabled`, `createErrorReporter`; config plugin in `app.config.ts` with the organization slug `nidro-team`, the project slug `tsuzuki` and the EU url `https://de.sentry.io/`, `getSentryExpoConfig` in `metro.config.js`). `pnpm-workspace.yaml` `allowBuilds` denies the `@sentry/cli` install script: its binary comes from optional platform packages. Core and features depend on the interface; the composition root injects the implementation. `src/ui/` imports neither core nor platform, so a ui component that reports an error takes an optional callback prop wired by the composition root.
- Sentry settings: errors only, no performance tracing, no session replay, `sendDefaultPii: false`; disabled when `__DEV__` is true or no DSN is configured, in which case the reporter writes to the console in development. The Sentry environment is the app variant. The Sentry organization is in the EU data region.
- Scrubbing: `beforeSend` and `beforeBreadcrumb` remove emails, JWTs, bearer tokens and API keys from messages, exception values and breadcrumb data, drop authorization and cookie headers and request bodies, drop the `user` fields, and drop notes. The scrubbers are pure functions (`scrubEvent`, `scrubBreadcrumb` in `src/platform/sentry-scrub.ts`) tested with representative payloads.
- Accepted limitation: native crash events (Java, Kotlin, Objective-C) are sent by the native SDK and do not pass through the JS `beforeSend`. Mitigation on the server side: the Sentry project enables "Data Scrubber", "Use Default Scrubbers" and "Prevent Storing of IP Addresses" (owner setup in `ARCHITECTURE.md` §10).
- Missing translation keys (each key once per language) and missing plural rules are reported through the reporter in every build: Sentry in release builds, the console in development. A key and a language are not personal data.
- `src/platform/sentry.ts` is the only production file allowed to use `console` (ESLint `no-console`).
- Source maps are uploaded during the EAS build of the `preview` and `production` profiles with `SENTRY_AUTH_TOKEN`, a secret of those EAS environments. The `development` profile disables the upload.

### Supabase client

The Supabase client is not created by the composition root in F-10: it is wired with its first consumer (the auth or library repositories), from the parsed app env.

## Consequences

- Maintainability: one Zod schema validates the env twice, at build time and at startup, so a missing or malformed value fails early with a clear message. Variants, channels and environments share one name each, which keeps the mapping readable. `ErrorReporter` lets core and features report errors without knowing Sentry; replacing Sentry touches `src/platform/sentry.ts` and the build config only.
- Security: HTTPS only, no cleartext exception; build values come from EAS environments, the Sentry auth token is an EAS secret, and the app ships only public values (anon or publishable key, DSN). Sentry receives errors only, scrubbed before sending, with no default PII, no replay and no tracing; native crash events rely on Sentry's server-side scrubbing instead. Separate app ids keep the production session and storage apart from development and preview installs.
- Performance: no tracing or replay overhead; the env is parsed once at startup.
- Operations: development builds share the staging database with preview builds, so a development session sees staging data. Every release bumps the app version (release-please), so with the `appVersion` runtime policy an update reaches only binaries of the version it was published from; a JS fix for an installed version is published from a commit carrying that version.
- Caching: an update keeps the app version, so the persisted query cache buster (ADR-0005) also includes a core `CACHE_SCHEMA_VERSION`, bumped when a persisted query shape changes.
- Web app: the env schema and the `ErrorReporter` interface stay in `src/core/`; a web app reads its env from its own build configuration and implements the reporter with the Sentry browser SDK.
