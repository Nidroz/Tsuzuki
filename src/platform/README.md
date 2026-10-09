# src/platform

Mobile-only adapters: device locale (`expo-localization`), MMKV storage, secure session storage (`expo-secure-store`), the app version and Sentry.
They implement interfaces defined in `src/core` and import nothing else from the app (`platform → core`, interfaces only).
MMKV and secure-store are native modules: the app runs in a development build, not in Expo Go (see the README).

- `locale.ts`: `useDeviceLanguageTags`, the `LocaleAdapter` of `src/core/i18n` built on `useLocales()`; it re-renders when the OS languages change.
- `intl-polyfills.ts`: side-effect import, first in `app/_layout.tsx`. Installs `Intl.PluralRules` (`@formatjs/intl-pluralrules`, English and French data) on engines that lack it, such as Hermes; a no-op where the engine has it.
- `storage.ts`: `createStorage()`, the `StorageAdapter` over one unencrypted MMKV instance (`tsuzuki`). It never holds secrets: preferences and the persisted query cache.
- `secure-session.ts`: `createSecureSessionStorage()`, the `SessionStorage` for the auth session over `expo-secure-store`, readable only while the device is unlocked and never restored from a backup on another device (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Values over 2048 UTF-8 bytes are unreliable there, so each value is split by code point into chunks under `<key>.<index>`, then the chunk count is written under `<key>`, last. A read returns `null` (fail closed) when the count is missing or invalid or a chunk is missing; leftover chunks of a previous longer value are deleted after each write. Keys must match `^[\w-]+$`: the dot is reserved for the chunk suffix.
- `app-version.ts`: `APP_VERSION`, the version from `app.config.ts` (via `expo-constants`), used as the persisted cache buster.
