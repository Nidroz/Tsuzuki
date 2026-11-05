# e2e

Maestro end-to-end flows of the Android development build (`io.github.nidroz.tsuzuki.dev`, ADR-0012). Every flow finds elements by id only, so the device language does not matter. Shared steps live in `subflows/` (launch signed out, sign in, sign out, open a pinned title by its deep link `tsuzuki://media/<namespace>/<kind>/<id>`, remove a title if present); Maestro runs only the top-level files of the folder it is given, so they never run as flows.

## Flows

CI, `flows/` (run by the e2e workflow):

- `smoke.yaml`: the app launches on Discover and each tab opens its screen.
- `search.yaml`: search a title, open a result, find the search among the recent searches, clear them.
- `discovery.yaml`: top manhwa, open one, come back to the same section, format and list.
- `library.yaml`: as a guest, add a title, `+1` twice, change the status, set a score, remove it.
- `favorites.yaml`: as a guest, favorite a title outside the library, unfavorite it from the Favorites tab.
- `auth.yaml`: sign in form problems and the way to Create an account, no backend.
- `sign-in.yaml`: sign in with the shared test account, see the signed-in state, sign out with no confirmation.
- `guest-merge.yaml`: pre-clean; as a guest add Fullmetal Alchemist: Brotherhood (`mal/anime/5114`) with the note `e2e-<E2E_RUN_ID>`; sign in; the merge concludes, the account library lists it with this run's note; remove it, sign out.
- `sign-out-unsynced.yaml`: sign in, airplane mode on, add Steins;Gate (`mal/anime/9253`, queued), sign out: the unsynced confirmation, confirm, the library tab is empty; airplane mode off (also in the flow's `onFlowStart` and `onFlowComplete` hooks), then remove the title if a write reached the account, sign out.

Manual, `flows-manual/` (never run by CI, throwaway account only, see below):

- `delete-account.yaml`: sign in, delete the account after the confirmation, see the deleted state, then the same credentials are refused.
- `gone-purge-prepare.yaml` then `gone-purge-check.yaml`: an account deleted from another client while the app holds its session; the refused token refresh signs the app out and purges that user's library (A-10).

Not automatable: stuck writes (a write the database refuses, the notice on the library tab, Try again, Discard). The client schemas reject every value the database would refuse before any request, so a refusal needs a server-side change on staging (a temporary constraint), which no flow may make; route tests cover it.

`tools/e2e/maestro-flows.test.mjs` (`pnpm test:tooling`) checks every flow statically: the yaml, the app id, each `id:` against the testIDs of `app/` and `src/`, the subflow paths, the variables, the workflow's `maestro test` line, and that no CI flow reaches the account deletion or the throwaway account.

## Shared test account

- A staging account dedicated to E2E, email confirmed, its library empty; its credentials live only in the `e2e` environment secrets `E2E_EMAIL` and `E2E_PASSWORD` (and in the shell of a local run), never in a file.
- Each flow removes what it adds and starts with a pre-clean, so it is safe to re-run after a half-way failure. Each signed-in flow uses its own pinned title.
- Two runs never use it at the same time: the workflow allows one run at a time, and nobody runs the flows locally while a CI run is in progress.
- No CI flow reaches the account deletion screen: the tooling test fails otherwise.

## CI

Workflow `.github/workflows/e2e.yml`, job `e2e`: on pull requests to `main` and by manual dispatch, in the GitHub environment `e2e`. It installs the latest finished EAS development build (it never builds one: a new native module needs a new development build before the next run), starts Metro with the staging app env, boots an Android emulator (API 34, en-US) and runs `maestro test -e E2E_EMAIL=... -e E2E_PASSWORD=... -e E2E_RUN_ID=<run id>-<attempt> e2e/flows`. The flows are first exercised there: they were written without a device.

## Local run

Maestro and the Android tools are installed by the developer, not by pnpm.

- Maestro CLI 2.10.0: download `maestro.zip` from the GitHub release, unzip it and add its `bin` folder to `PATH`.
- Java 17 or later, with `JAVA_HOME` set.
- Android SDK platform-tools, with `adb` on `PATH`.
- An Android emulator, or a USB device with USB debugging on.
- The development build APK installed on it, built with EAS: see "Development build" in the [README](../README.md#development-build). Expo Go cannot run the app (native modules).
- iOS flows need macOS (Xcode simulator); `sign-out-unsynced.yaml` uses the Android airplane mode.

Then:

1. `pnpm start` with the staging app env (Metro on port 8081).
2. `adb reverse tcp:8081 tcp:8081`.
3. `maestro test -e E2E_EMAIL=<email> -e E2E_PASSWORD=<password> -e E2E_RUN_ID=local-$(date +%s) e2e/flows` (`pnpm test:e2e` passes no value: the signed-in flows need them).

The flows open the project with the dev-client deep link `tsuzuki://expo-development-client/?url=<url-encoded Metro URL>`, Metro at `http://127.0.0.1:8081` by default; a phone on the LAN adds `-e METRO_URL=http://<lan-ip>:8081`, but `sign-out-unsynced.yaml` then loses Metro in airplane mode: run it through `adb reverse`. Never commit credentials. The typed credentials are labelled, but Maestro keeps the logs of local runs under `~/.maestro/tests/`: delete them after a run with real credentials.

## Manual flows

Never with the shared test account: the manual flows read `E2E_THROWAWAY_EMAIL` and `E2E_THROWAWAY_PASSWORD` only.

Throwaway account: in the staging dashboard, Authentication → Users → Add user → Create new user, with an address nobody uses and "Auto Confirm User" checked (or Create an account in the app, then confirm the email). One account per run: both flows end with it deleted.

Account deletion (needs `delete-account` deployed on staging):

```sh
maestro test -e E2E_THROWAWAY_EMAIL=<email> -e E2E_THROWAWAY_PASSWORD=<password> e2e/flows-manual/delete-account.yaml
```

Gone purge, on one device, in this order. The app only notices a deleted account when a token refresh is refused while its access token is still valid, the app in the foreground (ADR-0018 "User gone detection"): auth-js asks 90 to 120 s before the expiry. The times below assume the staging access token lifetime of 3600 s (Authentication settings of the staging project; scale them otherwise), T being the sign in of the first flow.

1. Keep the screen on for the whole run: `adb shell svc power stayon true` (afterwards: `adb shell svc power stayon false`).
2. `maestro test -e E2E_THROWAWAY_EMAIL=<email> -e E2E_THROWAWAY_PASSWORD=<password> e2e/flows-manual/gone-purge-prepare.yaml`; note T.
3. Between T + 1 min and T + 45 min, delete the account from another client: the staging dashboard, Authentication → Users → the account → Delete user, by the owner; or sign in with it on another device and use its Delete account. Never on this device.
4. Between T + 50 min and T + 55 min: `maestro test e2e/flows-manual/gone-purge-check.yaml`. It relaunches the app without clearing its data and waits up to 10 min in the foreground for the refused refresh (T + 58 min), then the signed-out state and an empty library tab.

If the check times out, the refresh was attempted before the deletion (the session then renews for another hour) or while the app was in the background: start over with a new throwaway account.
