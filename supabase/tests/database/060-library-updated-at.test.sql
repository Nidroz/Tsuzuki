-- updated_at of library entries (ADR-0016): a client can neither set nor change it, so every
-- regular write takes the server time; only a role with the column privilege (the guest merge's
-- security definer function, trusted server roles) sets it, and then a future value is capped at
-- now(). the trigger is the only path, so the rule holds for every writer
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select trigger_is(
  'public', 'library_entries', 'library_entries_set_updated_at',
  'private', 'set_library_entry_updated_at',
  'library_entries stamps updated_at with private.set_library_entry_updated_at'
);

select isnt_definer(
  'private', 'set_library_entry_updated_at', array[]::name[],
  'the timestamp trigger runs with the rights of the writer'
);

select ok(
  (
    select tgtype::integer & 2 = 2 and tgtype::integer & 4 = 4 and tgtype::integer & 16 = 16
    from pg_catalog.pg_trigger
    where tgrelid = 'public.library_entries'::regclass
      and tgname = 'library_entries_set_updated_at'
  ),
  'the timestamp trigger fires before insert and before update'
);

-- setup as postgres: one backdated entry of the owner
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format,
  media_is_adult, created_at, updated_at
) values (
  '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001',
  'mal', 'anime', 1, 'Cowboy Bebop', 'tv', false, '2026-01-01', '2026-01-10'
);

-- owner: the regular writes of the api
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    update public.library_entries
    set progress = 2, updated_at = '2026-01-20'
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'a regular update cannot set updated_at'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      updated_at
    ) values ('mal', 'anime', 2, 'Trigun', 'tv', false, '2026-01-20')
  $$,
  '42501',
  null,
  'a regular insert cannot list updated_at'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      updated_at
    ) values ('mal', 'anime', 1, 'Cowboy Bebop', 'tv', false, '2026-01-20')
    on conflict (user_id, id_namespace, media_kind, external_id) do update
    set progress = excluded.progress, updated_at = excluded.updated_at
  $$,
  '42501',
  null,
  'a regular upsert cannot list updated_at'
);

select results_eq(
  $$
    update public.library_entries
    set progress = 3
    where id = '00000000-0000-0000-0000-00000000a001'
    returning progress, updated_at = now()
  $$,
  $$ values (3, true) $$,
  'a regular update stamps now()'
);

select results_eq(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 3, 'Planetes', 'tv', false)
    returning created_at = now(), updated_at = now()
  $$,
  $$ values (true, true) $$,
  'a regular insert stamps now()'
);

-- trusted writers: an explicit value is kept, a future one capped at now()
reset role;

select results_eq(
  $$
    insert into public.library_entries (
      user_id, id_namespace, media_kind, external_id, media_title, media_format,
      media_is_adult, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000001', 'mal', 'anime', 4, 'Mushishi', 'tv', false,
      '2100-01-01'
    )
    returning updated_at = now()
  $$,
  $$ values (true) $$,
  'an explicit future updated_at is capped at now() on insert'
);

select results_eq(
  $$
    update public.library_entries
    set updated_at = '2100-01-01'
    where id = '00000000-0000-0000-0000-00000000a001'
    returning updated_at = now()
  $$,
  $$ values (true) $$,
  'an explicit future updated_at is capped at now() on update'
);

select results_eq(
  $$
    update public.library_entries
    set updated_at = '2026-01-05 08:00:00.123456+00'
    where id = '00000000-0000-0000-0000-00000000a001'
    returning updated_at
  $$,
  $$ values ('2026-01-05 08:00:00.123456+00'::timestamptz) $$,
  'an explicit past updated_at is kept'
);

select results_eq(
  $$
    update public.library_entries
    set progress = 4
    where id = '00000000-0000-0000-0000-00000000a001'
    returning updated_at = now()
  $$,
  $$ values (true) $$,
  'a trusted update leaving updated_at unchanged stamps now()'
);

select * from finish();

rollback;
