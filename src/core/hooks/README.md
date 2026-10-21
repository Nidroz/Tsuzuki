# src/core/hooks

React hooks over the repository and `CatalogProvider` interfaces, consumed by feature screens: TanStack Query hooks (the paged catalog lists `useSearch`, `useTopMedia` and `useCurrentSeason` over `usePagedCatalogList`, `useMediaDetail`, `useGenres`, the library entry `useLibraryEntry` and its actions `useLibraryEntryActions`, later the library list…) and the hooks of local data (`useRecentSearches`).
Each injected dependency reaches them through its own React context, given by the composition root: `CatalogContextProvider` (`useCatalogProvider`), `RecentSearchesContextProvider` (`useRecentSearches`) and `LibraryContextProvider` (`useLibraryContext`, read by the library hooks); each hook throws outside its provider.
They depend only on interfaces, never on Supabase or a catalog provider directly. Hooks are imported by file (`@core/hooks/use-search`): there is no barrel.
`src/core/` never imports React Native, Expo modules or NativeWind.

## Library writes

`LibraryContextProvider({ repository, children })`, inside the query client provider, gives the hooks the active `LibraryRepository` and a `LibraryWriter` over it (`library-writer.ts`, plain TypeScript over the `QueryClient`). Screens use the hooks only and never know which repository is active, so the auth switch (A-03) changes the provider's `repository` prop alone; on that change, and on unmount, the pending coalesced writes go to the repository they were made for (`flushAll`).

- `useLibraryEntry(key, { media })`: the entry query (`queryKeys.library.entry`, `STALE_TIMES.library`), read through the writer. With the catalog's `media`, the entry is shown with the fresh snapshot (`withMediaSnapshot`): display only, viewing writes nothing.
- `useLibraryEntryActions(key, { media })`: `add`, `remove`, `setStatus`, `setProgress`, `incrementProgress`, `setScore`, `setNotes` (blank text clears the notes) apply the domain rules (BR-01 to BR-04, BR-07, BR-09) and, with `media`, first refresh the snapshot (`refreshMediaSnapshot`): the snapshot is written with a user action only. Fire and forget; `error` holds the last failure until the next action or `dismissError`.
- The writer applies each change optimistically (after cancelling the entry's fetch in flight), skips no-op changes (BR-09), debounces `+1` taps for `PROGRESS_WRITE_COALESCE_MS` into one write of the latest entry, and runs the repository calls of one key one after the other. A read first writes the pending change of its key, so a refetch never returns an older state. A success shows the stored entry (unless a newer change came) and invalidates the `['library']` list query only; a failure rejects the action and refetches the entry.
