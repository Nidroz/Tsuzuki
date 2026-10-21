# src/core/preferences

The user's theme, language and adult content preferences, exposed to routes and features through `PreferencesProvider` and `usePreferences()` (`theme`, `language`, `showAdult`, `setTheme`, `setLanguage`, `setShowAdult`), imported from `@core/preferences/index`.
The provider is controlled and holds no state: the composition root owns the preferences and passes them with their change handlers. The theme preference (`system`, `light`, `dark`, default `system`, FR-30) is declared here; the language preference stays in `src/core/i18n/`. The adult content preference (`showAdult`, FR-32, BR-06) is a boolean whose default `DEFAULT_SHOW_ADULT` (false, adult titles hidden) lives in `src/core/domain/content-filter.ts`; it is stored on the device only, syncing it to an account is Phase 4.

Persistence (F-09, L-06): `loadPreferences(storage)` reads the preferences from a `StorageAdapter` (MMKV on mobile) under `preferences.theme`, `preferences.language` and `preferences.showAdult`, parsing each with Zod; a missing or unknown theme or language falls back to `system`. The adult content setting is stored as the exact strings `true` / `false`: anything else, including a missing value, falls back to hidden (fail closed). `saveThemePreference`, `saveLanguagePreference` and `saveShowAdultPreference` write them back.

`src/core/` never imports React Native, Expo modules or NativeWind.
