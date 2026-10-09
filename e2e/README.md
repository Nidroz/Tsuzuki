# e2e

Maestro end-to-end flows in `flows/`. Today: a smoke flow (`flows/smoke.yaml`) checking that the app launches on the Discover screen, then pressing each tab of the tab bar (Search, Library, Favorites, Settings, back to Discover) and checking that its screen shows. The critical flows from `CONTRIBUTING.md` §6 follow: search → add → +1 → favorite, sign in, guest → account merge.

## Prerequisites

Maestro and the Android tools are installed by the developer, not by pnpm.

- Maestro CLI 2.10.0: download `maestro.zip` from the GitHub release, unzip it and add its `bin` folder to `PATH`.
- Java 17 or later, with `JAVA_HOME` set.
- Android SDK platform-tools, with `adb` on `PATH`.
- An Android emulator, or a USB device with USB debugging on.
- The development build APK of the app (development variant, `io.github.nidroz.tsuzuki.dev`, ADR-0012) installed on the emulator or device, built with EAS: see "Development build" in the [README](../README.md#development-build). Expo Go cannot run the app (native modules).
- iOS flows need macOS (Xcode simulator).

## Run

1. `pnpm start` (Metro on port 8081).
2. For a USB device (or an emulator), forward Metro to it if needed: `adb reverse tcp:8081 tcp:8081`.
3. In a second terminal: `pnpm test:e2e`.

The flows launch the development build and open the project with the dev-client deep link `tsuzuki://expo-development-client/?url=<url-encoded Metro URL>`, Metro at `http://127.0.0.1:8081` by default. For a phone on the LAN, override the Metro URL:

```sh
maestro test -e METRO_URL=http://<lan-ip>:8081 e2e/flows
```

Local runs are optional; the flows run in CI on an Android emulator from R-01.
