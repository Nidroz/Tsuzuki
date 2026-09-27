# src/core/hooks

TanStack Query hooks (`useSearch`, `useMedia`, `useLibrary`…) consumed by feature screens.
They depend only on repository and `CatalogProvider` interfaces, never on Supabase or a catalog provider directly.
`src/core/` never imports React Native, Expo modules or NativeWind.
