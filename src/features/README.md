# src/features

Mobile screen logic, one folder per feature: `search`, `discovery`, `library`, `media-detail`, `favorites`, `auth`, `settings`.
Each folder is created by the backlog item that implements it.
Features compose `src/ui` primitives and `src/core` hooks; they never import Supabase or a catalog provider directly.
