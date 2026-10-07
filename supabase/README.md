# supabase

Database migrations, Edge Functions and pgTAP RLS tests.
The project config (`config.toml`) sets the auth rules (deep link redirect, password policy, email confirmation) and loads `seed.sql`, which is intentionally empty. The schema is described in `docs/ARCHITECTURE.md` §5.

## Rules

- Every table has RLS enabled with policies and pgTAP tests in the same PR.
- One policy per command, `to authenticated`, comparing with `(select auth.uid())`. `anon` gets no policy and no grant.
- Every new table needs explicit grants: default privileges are revoked for `anon` and `authenticated`, so a forgotten grant fails closed.
- Functions live in the `private` schema with `set search_path = ''`, fully qualified names, and `revoke execute ... from public, anon, authenticated`.
- An applied migration is never edited: create a new one with `pnpm exec supabase migration new <name>`.
- The `service_role` key exists only in Edge Function secrets, never in the app.

## Local database and RLS tests

The Supabase CLI is a dev dependency locked by the lockfile: run it with `pnpm exec supabase`, never a global install.

```sh
pnpm exec supabase start   # needs Docker running
pnpm test:rls              # runs the pgTAP tests in supabase/tests
pnpm exec supabase stop
```

CI (the `rls` job of `.github/workflows/ci.yml`) runs the same pgTAP tests with the locked CLI on a fresh runner.
It starts only the database with `pnpm exec supabase db start`, which applies the migrations, then runs `pnpm test:rls`.

`supabase/tests/database/000-rls-enabled.test.sql` is a lasting guard: it fails as soon as a table in `public` has row level security disabled.

## Writing RLS tests

- Each test file is one transaction, rolled back at the end.
- Users are inserted into `auth.users` with fixed UUIDs and `@example.test` emails.
- Impersonate a user with `set local role authenticated` and `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)`.
- Use `set local role anon` for anonymous access and `reset role` to return to the setup role.

## Generated types

`pnpm db:types` (needs the local stack) regenerates `src/core/repositories/supabase/database.types.ts`.
Commit it with the migration that changes the schema: the CI `rls` job fails when it drifts.
