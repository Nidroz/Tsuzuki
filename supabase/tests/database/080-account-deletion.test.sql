-- account deletion (FR-24): the delete-account function hard deletes the auth user, which runs
-- delete from auth.users. every row of that user in public goes with it through the foreign key
-- cascades, and no row of another user does. lasting guard: every foreign key of the project
-- schemas cascades on delete and every user id column references auth.users, so a future table
-- holding user data without the cascade fails here
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

-- setup as postgres: the sign-up trigger creates both profiles
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'deleted@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'kept@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format, media_total_units,
  media_is_adult
) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 1, 'Cowboy Bebop', 'TV', 26, false
  ),
  (
    '00000000-0000-0000-0000-00000000a002',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'manga', 1, 'Cowboy Bebop', 'Manga', 3, false
  ),
  (
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-000000000002',
    'mal', 'manga', 5, 'Monster', 'Manga', 162, false
  );

-- a progress change writes one event per entry
update public.library_entries
set progress = 1
where id in (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000a002',
  '00000000-0000-0000-0000-00000000b001'
);

-- rows per user, the deleted user first: profiles, library entries, progress events
select results_eq(
  $$
    select
      (select count(*) from public.profiles where id = u.id),
      (select count(*) from public.library_entries where user_id = u.id),
      (select count(*) from public.progress_events where user_id = u.id)
    from (
      values
        (1, '00000000-0000-0000-0000-000000000001'::uuid),
        (2, '00000000-0000-0000-0000-000000000002'::uuid)
    ) as u (ordinal, id)
    order by u.ordinal
  $$,
  $$ values (1::bigint, 2::bigint, 2::bigint), (1::bigint, 1::bigint, 1::bigint) $$,
  'before deletion, both users have a profile, entries and events'
);

-- what the auth admin delete runs
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';

select results_eq(
  $$
    select
      (select count(*) from public.profiles where id = u.id),
      (select count(*) from public.library_entries where user_id = u.id),
      (select count(*) from public.progress_events where user_id = u.id)
    from (values ('00000000-0000-0000-0000-000000000001'::uuid)) as u (id)
  $$,
  $$ values (0::bigint, 0::bigint, 0::bigint) $$,
  'deleting the auth user deletes their profile, entries and events'
);

select results_eq(
  $$
    select
      (select count(*) from public.profiles where id = u.id),
      (select count(*) from public.library_entries where user_id = u.id),
      (select count(*) from public.progress_events where user_id = u.id)
    from (values ('00000000-0000-0000-0000-000000000002'::uuid)) as u (id)
  $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$,
  'deleting a user leaves another user''s profile, entries and events untouched'
);

-- lasting guard: a foreign key with no action, restrict or set null would block the deletion or
-- leave the user's data behind
select is_empty(
  $$
    select n.nspname, c.conname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_namespace n on n.oid = c.connamespace
    where n.nspname in ('public', 'private')
      and c.contype = 'f'
      and c.confdeltype <> 'c'
  $$,
  'every foreign key of the public and private schemas cascades on delete'
);

select set_has(
  $$
    select t.relname::text, a.attname::text
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where n.nspname = 'public'
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
  $$,
  $$
    values
      ('library_entries', 'user_id'),
      ('profiles', 'id'),
      ('progress_events', 'user_id')
  $$,
  'profiles, library entries and progress events reference auth.users'
);

select is_empty(
  $$
    select t.relname, a.attname
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class t on t.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relkind in ('r', 'p')
      and a.attname = 'user_id'
      and not a.attisdropped
      and not exists (
        select 1
        from pg_catalog.pg_constraint c
        where c.conrelid = t.oid
          and c.contype = 'f'
          and c.confrelid = 'auth.users'::regclass
          and a.attnum = any (c.conkey)
      )
  $$,
  'every user_id column of a public table references auth.users'
);

select * from finish();

rollback;
