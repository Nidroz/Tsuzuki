# supabase

Database migrations, Edge Functions and pgTAP RLS tests.
The project config (`config.toml`) is created in F-03 with the CLI defaults and tuned in F-08 (auth, redirect URLs, seed).

## Rules

- Every table has RLS enabled with policies and pgTAP tests in the same PR.
- An applied migration is never edited: create a new one with `pnpm exec supabase migration new <name>`.
- The `service_role` key exists only in Edge Function secrets, never in the app.

## Local database and RLS tests

The Supabase CLI is a dev dependency locked by the lockfile: run it with `pnpm exec supabase`, never a global install.

```sh
pnpm exec supabase start   # needs Docker running
pnpm test:rls              # runs the pgTAP tests in supabase/tests
pnpm exec supabase stop
```

`supabase/tests/database/000-rls-enabled.test.sql` is a lasting guard: it fails as soon as a table in `public` has row level security disabled.
