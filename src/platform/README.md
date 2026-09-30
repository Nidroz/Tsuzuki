# src/platform

Mobile-only adapters: device locale (`expo-localization`), MMKV storage, secure session storage (`expo-secure-store`) and Sentry.
They implement interfaces defined in `src/core` and import nothing else from the app (`platform → core`, interfaces only).

- `locale.ts`: `useDeviceLanguageTags`, the `LocaleAdapter` of `src/core/i18n` built on `useLocales()`; it re-renders when the OS languages change.
