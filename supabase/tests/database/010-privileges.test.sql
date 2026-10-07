-- lasting guards for least privilege (CONTRIBUTING.md section 7): generic catalog queries that keep
-- passing as tables and functions are added, and fail as soon as one is exposed to an api role.
-- also pins the policy names and roles of the schema v1 tables
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- anon: no access at all

select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not exists (
        select 1 from pg_catalog.pg_depend d where d.objid = c.oid and d.deptype = 'e'
      )
      and (
        has_table_privilege(
          'anon', c.oid, 'select, insert, update, delete, truncate, references, trigger'
        )
        or has_any_column_privilege('anon', c.oid, 'select, insert, update, references')
      )
  $$,
  'anon has no privilege on any table or view in public'
);

select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      -- case: and does not fix the evaluation order, and the check errors on non-sequences
      and case
        when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update')
        else false
      end
  $$,
  'anon has no privilege on any sequence in public'
);

-- authenticated: truncate bypasses rls, references and trigger are never needed by the api

select is_empty(
  $$
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not exists (
        select 1 from pg_catalog.pg_depend d where d.objid = c.oid and d.deptype = 'e'
      )
      and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')
  $$,
  'authenticated cannot truncate, reference or add triggers to any table in public'
);

-- functions: only triggers call them, never the api. extension members are skipped: supabase test
-- db installs pgtap in public for the duration of the run

select is_empty(
  $$
    select n.nspname, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
      )
  $$,
  'no function in public or private is executable by anon or authenticated'
);

select ok(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon has no usage on schema private'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated has no usage on schema private'
);

select is_empty(
  $$
    select n.nspname, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and not coalesce(p.proconfig @> array['search_path=""'], false)
  $$,
  'every function in public and private pins an empty search_path'
);

-- fail closed: a table added later without explicit grants is unreachable from the api.
-- the probe is rolled back with the transaction
create table public.probe_default_acl (id integer generated always as identity);

select ok(
  not has_table_privilege(
    'anon',
    'public.probe_default_acl',
    'select, insert, update, delete, truncate, references, trigger'
  )
  and not has_table_privilege(
    'authenticated',
    'public.probe_default_acl',
    'select, insert, update, delete, truncate, references, trigger'
  ),
  'a new table in public grants nothing to anon or authenticated by default'
);

select ok(
  not has_sequence_privilege(
    'anon',
    pg_get_serial_sequence('public.probe_default_acl', 'id'),
    'usage, select, update'
  )
  and not has_sequence_privilege(
    'authenticated',
    pg_get_serial_sequence('public.probe_default_acl', 'id'),
    'usage, select, update'
  ),
  'a new sequence in public grants nothing to anon or authenticated by default'
);

-- policies: one per command, authenticated only

select policies_are(
  'public',
  'profiles',
  array['profiles_select_own', 'profiles_update_own'],
  'profiles has exactly the select and update policies'
);

select policies_are(
  'public',
  'library_entries',
  array[
    'library_entries_select_own',
    'library_entries_insert_own',
    'library_entries_update_own',
    'library_entries_delete_own'
  ],
  'library_entries has exactly the select, insert, update and delete policies'
);

select policies_are(
  'public',
  'progress_events',
  array['progress_events_select_own'],
  'progress_events has exactly the select policy'
);

select is_empty(
  $$
    select tablename, policyname, roles
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and roles <> array['authenticated']::name[]
  $$,
  'every policy in public applies to authenticated only'
);

select * from finish();

rollback;
