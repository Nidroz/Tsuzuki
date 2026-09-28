# e2e

Maestro end-to-end flows in `flows/`. Today: a smoke flow (`flows/smoke.yaml`) checking that the app launches and shows the home screen. The critical flows from `CONTRIBUTING.md` §6 follow: search → add → +1 → favorite, sign in, guest → account merge.

## Prerequisites

Maestro and the Android tools are installed by the developer, not by pnpm.

- Maestro CLI 2.10.0: download `maestro.zip` from the GitHub release, unzip it and add its `bin` folder to `PATH`.
- Java 17 or later, with `JAVA_HOME` set.
- Android SDK platform-tools, with `adb` on `PATH`.
- An Android emulator, or a USB device with USB debugging on.
- Expo Go matching Expo SDK 57 on the emulator or device.
- iOS flows need macOS (Xcode simulator).

## Run

1. `pnpm start`, then press `a` to open the app on Android.
2. In a second terminal: `pnpm test:e2e`.

The flows open `exp://127.0.0.1:8081` by default. For a phone on the LAN, override the Metro URL:

```sh
maestro test -e METRO_URL=exp://<lan-ip>:8081 e2e/flows
```

## Next

- F-07 adds the tabs check to the smoke flow.
- F-09 switches the flows from Expo Go to the development build.
