# src/core/schemas

Zod schemas for user input (forms, deep link params), database rows and stored device content (the guest library).
Every external input is parsed at the boundary; inside the app, types are trusted.
`src/core/` never imports React Native, Expo modules or NativeWind.
