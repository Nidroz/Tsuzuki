# e2e

Maestro end-to-end flows in `flows/`. Today: a smoke flow (`flows/smoke.yaml`) checking that the app launches on the Discover screen, then pressing each tab of the tab bar (Search, Library, Favorites, Settings, back to Discover) and checking that its screen shows; a search flow (`flows/search.yaml`) typing a title, opening a result from the live catalog, coming back to find the search among the recent searches, then clearing them; a discovery flow (`flows/discovery.yaml`) showing the top manhwa from the live catalog, opening the first one and coming back to the same section, format and list; a library flow (`flows/library.yaml`) searching a title, adding it to the library from its details, adding two episodes with `+1`, changing its status, setting a score, then removing it after the confirmation; a favorites flow (`flows/favorites.yaml`) searching a title, favoriting it from its details while it is outside the library (added as planned), finding it in the Favorites tab, unfavoriting it there (the row stays until the tab is opened again, the entry stays in the library), then seeing the tab empty; an auth flow (`flows/auth.yaml`) opening Sign in from the Settings, submitting an invalid email to see the form problems, then going to Create an account and back, without any backend (the form is checked on the device). The rest of the critical flows from `CONTRIBUTING.md` §6 follow: sign in against a backend, guest → account merge.

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
