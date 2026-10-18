# src/core/hooks

React hooks over the repository and `CatalogProvider` interfaces, consumed by feature screens: TanStack Query hooks (`useSearch`, `useMediaDetail`, later `useLibrary`…) and the hooks of local data (`useRecentSearches`).
Each injected dependency reaches them through its own React context, given by the composition root: `CatalogContextProvider` (`useCatalogProvider`) and `RecentSearchesContextProvider` (`useRecentSearches`); each hook throws outside its provider.
They depend only on interfaces, never on Supabase or a catalog provider directly. Hooks are imported by file (`@core/hooks/use-search`): there is no barrel.
`src/core/` never imports React Native, Expo modules or NativeWind.
