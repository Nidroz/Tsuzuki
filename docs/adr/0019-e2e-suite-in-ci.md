# ADR-0019: E2E suite in CI

- Status: Accepted
- Date: 2026-11-05

## Context

R-01 completes the Maestro suite (`CONTRIBUTING.md` §6: search → add → +1 → favorite; sign in; guest → account merge) and makes it the gate of what reaches production (`ARCHITECTURE.md` §10, moved from F-04). Starting point:

- The owner has no Android device or emulator at hand: the flows written since F-03 were reviewed but never run. CI is where they run first.
- The app runs only as a development build of the `development` variant (`io.github.nidroz.tsuzuki.dev`, ADR-0010 amendment, ADR-0012), which talks to the staging Supabase project and to the live catalog.
- The signed-in flows need a real account on staging. Staging is shared by every preview build, and the `service_role` key never leaves Edge Function secrets (`CONTRIBUTING.md` §7): no flow can create, confirm or delete a user by API.
- The GitHub Environment `staging` deploys from the branch `dev` only, which the ref of a pull request does not match.
- ADR-0010 left Maestro an unversioned developer install.

Options considered:

- App binary: **(a) build the APK in CI with Gradle** (`expo prebuild`, then `assembleDebug`): slower, and a second native toolchain (Android SDK, NDK) to keep in step with EAS. Rejected. **(b) a new EAS build per run**: EAS quota and queue time on every release PR. Rejected. **(c) the latest finished EAS development build, loading the tree under test from Metro on the runner**: chosen; valid as long as no native module changed.
- Where: **(a) a hosted device service (Maestro Cloud, EAS Workflows)**: costs, and another external account holding the secrets. Rejected. **(b) an Android emulator on a GitHub-hosted `ubuntu-24.04` runner with KVM**: chosen; free for a public repository.
- When: **(a) every PR to `dev`**: slow, loads staging and the live catalog, and the shared account would serialize every PR. Rejected. **(b) PRs to `main` (release, hotfix, release-please) and manual dispatch**: chosen: the gate sits where code reaches production.
- Secrets: **(a) the `staging` environment**: its branch policy refuses a pull request ref, and relaxing it would hand its deploy secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) to a PR job. Rejected. **(b) a dedicated environment `e2e`** holding only what the flows need: chosen.
- Accounts: **(a) a new account per run**: sign up needs an email confirmation or the service role key. Rejected. **(b) one confirmed shared account whose flows clean up after themselves, and a throwaway account for the destructive flows, run by hand**: chosen.

## Decision

### Workflow

`.github/workflows/e2e.yml`, workflow `E2E`, job `e2e` (`ubuntu-24.04`, timeout 60 min), under the workflow rules of `ARCHITECTURE.md` §10 (pinned SHAs, `permissions: {}` then `contents: read`, checkout without credentials):

- Triggers: `pull_request` to `main` and `workflow_dispatch`; never PRs to `dev`. The job `if` skips fork PRs, which get no secrets.
- Concurrency: one group for the whole workflow, never cancelled: two runs would share the test account.
- Environment `e2e`: secrets `EXPO_TOKEN`, `E2E_EMAIL`, `E2E_PASSWORD`; variables `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the staging values of the EAS `development` environment: public, they ship in the app), optional `EXPO_PUBLIC_JIKAN_BASE_URL`. No deployment branch restriction: the secrets are a dedicated staging test account and an Expo token, fork PRs never get secrets, and the `base-branch` policy limits the PRs to `main`. `EXPO_TOKEN` there is its own Expo robot token with the least role that can list builds and download their artifacts (Viewer; Developer if listing is refused), not the staging deploy token.
- Telemetry off (Maestro, Expo).

Steps, in order:

1. The secrets and variables checked present by comparison (`secrets.X != ''`), never exposed to the shell.
2. Checkout, the setup composite action, `actions/setup-java` v6.1.0 (Temurin 17, pinned SHA).
3. Maestro CLI 2.10.0 from its GitHub release: `maestro.zip` checked against a sha256 pinned in the workflow; never `curl | bash`.
4. `eas build:list --platform android --build-profile development --status finished --limit 1 --json --non-interactive`, then the APK download. Never a new EAS build. The step checks the app id and an https artifact URL and prints only the build id, creation time and commit.
5. KVM; Metro (`expo start`) in the background with `APP_VARIANT=development` and the staging variables, no secret in its env, then one Android bundle requested up front.
6. `reactivecircus/android-emulator-runner` v2.38.0, pinned by SHA (API 34, `google_apis`, `x86_64`, `pixel_6`, default locale en-US): `adb reverse tcp:8081 tcp:8081`, `adb install`, `maestro test -e E2E_EMAIL -e E2E_PASSWORD -e E2E_RUN_ID e2e/flows` (`E2E_RUN_ID` = run id and attempt).
7. On failure, the tail of the Metro log. No artifact upload: screenshots could show the test email.

New CI dependencies: the third-party action `reactivecircus/android-emulator-runner` (Apache-2.0, pinned by commit) and the Maestro CLI binary (Apache-2.0, version and sha256 pinned). M-01 bumps both, like the other action SHAs and gitleaks. This refines ADR-0010 for CI only: locally, Maestro stays a developer install, of the version `e2e/README.md` names.

Prerequisite: the latest finished EAS Android development build contains every native module of the tree under test. A change adding one (for example `expo-network` since A-05) needs `pnpm exec eas build --profile development --platform android` before the next E2E run, or the app fails to load.

### Flows

- CI, `e2e/flows/`: smoke, search, discovery, library, favorites, auth, sign-in, guest-merge, sign-out-unsynced. Shared steps in `e2e/subflows/`, never run as flows.
- Manual, `e2e/flows-manual/`: delete-account; gone-purge-prepare then gone-purge-check. A throwaway account only (`E2E_THROWAWAY_EMAIL`, `E2E_THROWAWAY_PASSWORD`), never in CI.
- Not automatable: stuck writes. The client schemas reject every value the database would refuse before any request, so a refusal needs a server-side change on staging, which no flow may make. Route tests cover it.
- Shared account: one confirmed staging account dedicated to E2E, its library empty. The flows pre-clean, remove what they add, mark their notes per run (`E2E_RUN_ID`) and never reach account deletion. The `service_role` key never appears in CI, a flow or the repository.
- `tools/e2e/maestro-flows.test.mjs` (`pnpm test:tooling`) checks the flows statically: each id against the testIDs of the source, the subflow paths, the variables against the workflow's `-e` values, the deletion guard.
- What no flow covers on a real device (the library tab re-sort after `+1`, the Hermes `Intl.Collator` title sort on Android and iOS) is an owner checklist in the R-01 PR; a finding becomes a fix in R-02.

### Gate

Once the `e2e` job has passed, the owner adds `e2e` as a required status check for `main` only: it never runs on PRs to `dev`, where requiring it would block every PR. `protect-main-dev` covers both branches today, so this needs the per-branch split of `ARCHITECTURE.md` §10 "Repository settings (owner)" step 5, or a ruleset targeting `main` only.

## Consequences

- Maintainability: one workflow and two pinned dependencies, bumped by M-01. The development build must stay fresh: a new native module without a new development build fails the next run (the failure is the only check). The flows were written without a device and may need fixes on their first runs.
- Reliability: the flows reach the live catalog and staging, so an outage or a rate limit fails a run (re-run by dispatch). The shared account must stay clean: a run stopped half-way is undone by the next run's pre-clean, and nobody runs the flows locally during a CI run.
- Security: the environment holds a test account and a build-listing Expo token, no deploy secret; fork PRs get nothing; Metro and the bundle never see a secret; no artifact. Accepted: with no branch restriction, a branch of this repository could change the workflow in a PR to `main`, or dispatch it, and read the test account; only the owner pushes branches.
- Performance: the slowest job of the repository (emulator boot, a cold bundle, nine flows), paid by release-level PRs only. Caching the AVD is a backlog item if it grows past about 30 minutes.
- Future web app: unaffected; the flows drive the mobile app and `src/core/` does not change.
- Left manual: the account deletion and gone purge flows, the device checks above, iOS.

## Update (2026-11-06)

The suite ran for the first time on the owner's draft release PR from `dev` to `main`. It needed five fixes before all nine CI flows passed (run of 2026-11-06, 12 min 49 s):

- the device state is printed as text when the flows fail (`tools/ci/e2e-diagnostics.sh`), with no screenshot or artifact;
- the system error dialogs are hidden on the emulator: "Pixel Launcher isn't responding" covered every app;
- every launch waits for the dev launcher home before it opens the project link, since a link sent while the app is still starting is dropped;
- a shared subflow (`e2e/subflows/wait-for-app.yaml`) closes the Expo dev menu, which opens over the app on a fresh install;
- `guest-merge` hides the keyboard before it saves the notes, since the keyboard covered the sheet's buttons.

GitHub dispatches a workflow only from the default branch. Until `e2e.yml` reaches `main` with the first release, a run is started by a pull request to `main` (a draft from `dev` will do), not by `workflow_dispatch`. The "re-run by dispatch" of "Consequences" applies from then on; before that, re-run the failed job of the pull request.

The gate is a second ruleset targeting `main` only (`require-e2e-main`, required check `e2e`), set by the owner. `protect-main-dev` stays as it is.
