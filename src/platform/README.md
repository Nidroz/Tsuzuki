# src/platform

Mobile-only adapters: MMKV storage, secure session storage (`expo-secure-store`) and Sentry.
They implement interfaces defined in `src/core` and import nothing else from the app (`platform → core`, interfaces only).
