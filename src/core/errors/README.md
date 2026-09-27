# src/core/errors

Typed error classes shared across the app; errors are never swallowed silently.
User-facing errors are translated through i18n keys, never hard-coded strings.
`src/core/` never imports React Native, Expo modules or NativeWind.
