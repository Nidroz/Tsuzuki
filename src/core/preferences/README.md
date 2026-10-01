# src/core/preferences

The user's theme and language preferences, exposed to routes and features through `PreferencesProvider` and `usePreferences()` (`theme`, `language`, `setTheme`, `setLanguage`), imported from `@core/preferences/index`.
The provider is controlled and holds no state: the composition root owns the preferences (persisted in F-09) and passes them with their change handlers. The theme preference (`system`, `light`, `dark`, default `system`, FR-30) is declared here; the language preference stays in `src/core/i18n/`.
`src/core/` never imports React Native, Expo modules or NativeWind.
