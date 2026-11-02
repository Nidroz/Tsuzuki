# src/core/repositories

Repository interfaces for library, profile and auth data; hooks depend on these, never on a backend.
Storage interfaces implemented in `src/platform/`: `StorageAdapter` (`storage-adapter.ts`, synchronous key-value, no secrets) and `SessionStorage` (`session-storage.ts`, the auth session only).
Implementations live in `supabase/` (the only place allowed to import the Supabase client, built by `create-supabase-client.ts`) and `local/` (device storage: guest mode, the recent searches, and the signed-in user's offline account library, its device copy and write queue over the `supabase/` store, ADR-0017), each added by its backlog item.
`src/core/` never imports React Native, Expo modules or NativeWind.
