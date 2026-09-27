# src/core/repositories

Repository interfaces for library, profile and auth data; hooks depend on these, never on a backend.
Implementations live in `supabase/` (the only place allowed to import the Supabase client) and `local/` (guest mode), each added by its backlog item.
`src/core/` never imports React Native, Expo modules or NativeWind.
