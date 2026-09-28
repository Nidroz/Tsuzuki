-- lasting guard for CONTRIBUTING.md section 7: every table in the public schema has row level
-- security enabled. it passes on an empty schema and fails as soon as a migration adds a table
-- without rls. per-table policy tests (owner crud, no cross-user access, no anon access) arrive
-- with the schema in F-08.
begin;

create extension if not exists pgtap with schema extensions;

select plan(1);

select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  $$,
  'every table in public has row level security enabled'
);

select * from finish();

rollback;
