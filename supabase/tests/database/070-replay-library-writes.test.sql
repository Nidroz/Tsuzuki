-- replay of queued library writes (BR-08, ADR-0017): public.replay_library_writes, security
-- definer with a pinned search_path, executable by authenticated only, the user from auth.uid()
-- only and expected_user_id a guard. a save keeps its own updated_at capped at now() and replaces
-- a strictly older stored copy only; a removal deletes a stored entry strictly older than its time
-- capped at now(), keeps an equal or newer one, and answers written when nothing is stored. one
-- answer row per write in input order; another user's rows are out of reach. the input checks
-- are in 071-replay-library-writes-input
begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- a queued save as the client sends it: op, every writable column and the time of the change
create function pg_temp.save_write(
  external_id integer,
  updated_at text,
  progress integer default 0,
  media_title text default 'Queued title'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'op', 'save',
    'id_namespace', 'mal',
    'media_kind', 'anime',
    'external_id', external_id,
    'media_title', media_title,
    'media_image_url', null,
    'media_format', 'tv',
    'media_total_units', 26,
    'media_is_adult', false,
    'status', 'current',
    'progress', progress,
    'score', null,
    'notes', null,
    'is_favorite', false,
    'started_at', null,
    'finished_at', null,
    'updated_at', updated_at
  )
$$;

-- a queued removal as the client sends it: op, the media key and the time of the removal
create function pg_temp.remove_write(external_id integer, updated_at text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'op', 'remove',
    'id_namespace', 'mal',
    'media_kind', 'anime',
    'external_id', external_id,
    'updated_at', updated_at
  )
$$;

-- the functions

select is_definer(
  'public', 'replay_library_writes', array['uuid', 'jsonb'],
  'replay_library_writes is security definer'
);

select ok(
  (
    select proconfig = array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'public.replay_library_writes(uuid, jsonb)'::regprocedure
  ),
  'replay_library_writes pins an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.replay_library_writes(uuid, jsonb)', 'execute')
  and not has_function_privilege('public', 'public.replay_library_writes(uuid, jsonb)', 'execute'),
  'anon and public cannot execute replay_library_writes'
);

select ok(
  has_function_privilege('authenticated', 'public.replay_library_writes(uuid, jsonb)', 'execute'),
  'authenticated can execute replay_library_writes'
);

select ok(
  not has_function_privilege('anon', 'private.remove_client_library_entry(jsonb)', 'execute')
  and not has_function_privilege(
    'authenticated', 'private.remove_client_library_entry(jsonb)', 'execute'
  )
  and not has_function_privilege('public', 'private.remove_client_library_entry(jsonb)', 'execute'),
  'nobody but its owner executes the helper private.remove_client_library_entry'
);

select isnt_definer(
  'private', 'remove_client_library_entry', array['jsonb'],
  'the removal helper runs with the rights of its caller'
);

select ok(
  (
    select proconfig = array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'private.remove_client_library_entry(jsonb)'::regprocedure
  ),
  'remove_client_library_entry pins an empty search_path'
);

-- setup as postgres: entries of the owner at fixed past times, one with microseconds, and one
-- entry of the other user under a key the owner removes
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format,
  media_is_adult, progress, created_at, updated_at
)
select
  pg_catalog.format('00000000-0000-0000-0000-00000000%s', seed.id_suffix)::uuid,
  seed.user_id, 'mal', 'anime', seed.external_id, seed.media_title, 'tv', false, seed.progress,
  '2026-01-01 00:00:00+00', seed.updated_at
from (
  values
    ('a001', '00000000-0000-0000-0000-000000000001'::uuid, 1, 'Cowboy Bebop', 5,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a002', '00000000-0000-0000-0000-000000000001'::uuid, 2, 'Trigun', 3,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a003', '00000000-0000-0000-0000-000000000001'::uuid, 3, 'Planetes', 4,
      '2026-01-10 12:00:00.123456+00'::timestamptz),
    ('a004', '00000000-0000-0000-0000-000000000001'::uuid, 4, 'Mushishi', 6,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a005', '00000000-0000-0000-0000-000000000001'::uuid, 5, 'Kaiba', 0,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a006', '00000000-0000-0000-0000-000000000001'::uuid, 6, 'Haibane Renmei', 2,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a007', '00000000-0000-0000-0000-000000000001'::uuid, 7, 'Texhnolyze', 2,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a008', '00000000-0000-0000-0000-000000000001'::uuid, 8, 'Ergo Proxy', 2,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('a009', '00000000-0000-0000-0000-000000000001'::uuid, 9, 'Paranoia Agent', 2,
      '2026-01-10 12:00:00+00'::timestamptz),
    ('b006', '00000000-0000-0000-0000-000000000002'::uuid, 6, 'Haibane Renmei', 10,
      '2026-01-10 12:00:00+00'::timestamptz)
) as seed (id_suffix, user_id, external_id, media_title, progress, updated_at);

-- callers

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.replay_library_writes('00000000-0000-0000-0000-000000000001', '[]') $$,
  '42501',
  null,
  'anon cannot call the replay'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.replay_library_writes('00000000-0000-0000-0000-000000000001', '[]') $$,
  '42501',
  'not authenticated',
  'a call without a user is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    select * from public.replay_library_writes(
      null, jsonb_build_array(pg_temp.save_write(30, '2026-01-15T08:00:00.000Z'))
    )
  $$,
  '42501',
  'not the expected user',
  'a call without an expected user is rejected'
);

-- owner, in no key order: removals of a newer (7), older (6) and equal (8) row, of a missing key
-- (12) and in the future (9); saves newer (1), older (2), equal (4), new (10), new in the future
-- (11) and replacing in the future (5)
select results_eq(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        pg_temp.remove_write(7, '2026-01-05T08:00:00.000Z'),
        pg_temp.save_write(1, '2026-01-20T08:00:00.000Z', 9, 'Cowboy Bebop (replayed)'),
        pg_temp.remove_write(12, '2026-01-15T08:00:00.000Z'),
        pg_temp.save_write(2, '2026-01-05T08:00:00.000Z', 26, 'Trigun (replayed)'),
        pg_temp.remove_write(6, '2026-01-20T08:00:00.000Z'),
        pg_temp.save_write(10, '2026-01-15T08:00:00.000Z', 2),
        pg_temp.save_write(4, '2026-01-10T12:00:00.000Z', 7, 'Mushishi (replayed)'),
        pg_temp.remove_write(8, '2026-01-10T12:00:00.000Z'),
        pg_temp.save_write(11, '2100-01-01T00:00:00.000Z', 1),
        pg_temp.save_write(5, '2100-01-01T00:00:00.000Z', 0),
        pg_temp.remove_write(9, '2100-01-01T00:00:00.000Z')
      )
    )
  $$,
  $$
    select 'mal'::public.media_id_namespace, 'anime'::public.media_kind, external_id,
      '00000000-0000-0000-0000-000000000001'::uuid, outcome
    from (
      values
        (7, 'kept'), (1, 'written'), (12, 'written'), (2, 'kept'), (6, 'written'),
        (10, 'written'), (4, 'kept'), (8, 'kept'), (11, 'written'), (5, 'written'),
        (9, 'written')
    ) as expected (external_id, outcome)
  $$,
  'the replay answers one row per write, in input order: the key, the caller and the outcome'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select media_title, progress, created_at, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      'Cowboy Bebop (replayed)', 9,
      '2026-01-01 00:00:00+00'::timestamptz, '2026-01-20 08:00:00+00'::timestamptz
    )
  $$,
  'a newer save replaces the values, takes its own time and keeps created_at'
);

select results_eq(
  $$
    select media_title, progress, updated_at
    from public.library_entries
    where id in ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000a004')
    order by external_id
  $$,
  $$
    values
      ('Trigun', 3, '2026-01-10 12:00:00+00'::timestamptz),
      ('Mushishi', 6, '2026-01-10 12:00:00+00'::timestamptz)
  $$,
  'a stored copy newer than or as recent as the save is kept unchanged'
);

select results_eq(
  $$
    select user_id, progress, created_at = now(), updated_at
    from public.library_entries
    where external_id = 10
  $$,
  $$
    values (
      '00000000-0000-0000-0000-000000000001'::uuid, 2, true,
      '2026-01-15 08:00:00+00'::timestamptz
    )
  $$,
  'a save of a new key is inserted for the caller with its own time, created now'
);

select ok(
  (select updated_at = now() from public.library_entries where external_id = 11),
  'a future time is capped to now on insert'
);

select results_eq(
  $$
    select created_at, updated_at = now()
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a005'
  $$,
  $$ values ('2026-01-01 00:00:00+00'::timestamptz, true) $$,
  'a future time is capped to now on replace'
);

select is_empty(
  $$
    select external_id
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id in (6, 9, 12)
  $$,
  'a removal deletes a strictly older row, also with a future time, and inserts nothing'
);

select results_eq(
  $$
    select external_id, updated_at
    from public.library_entries
    where id in ('00000000-0000-0000-0000-00000000a007', '00000000-0000-0000-0000-00000000a008')
    order by external_id
  $$,
  $$
    values
      (7, '2026-01-10 12:00:00+00'::timestamptz),
      (8, '2026-01-10 12:00:00+00'::timestamptz)
  $$,
  'a row newer than or as recent as the removal is kept'
);

select results_eq(
  $$
    select user_id, progress
    from public.library_entries
    where external_id = 6
  $$,
  $$ values ('00000000-0000-0000-0000-000000000002'::uuid, 10) $$,
  'the owner''s removal leaves the other user''s row of the key'
);

select results_eq(
  $$
    select entry_id, from_progress, to_progress
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, 5, 9) $$,
  'a replace changing the progress logs one progress event, an insert or a removal none'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- rows stored at now() by the capped future writes above: a later write timed in the future is
-- capped at the same now(), not strictly later, so it keeps them
select results_eq(
  $$
    select outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        pg_temp.remove_write(11, '2100-01-01T00:00:00.000Z'),
        pg_temp.save_write(5, '2100-01-01T00:00:00.000Z', 4)
      )
    )
  $$,
  $$ values ('kept'), ('kept') $$,
  'a future removal and a future save are capped at now and keep a row stored now'
);

-- millisecond client times against a microsecond updated_at (…:00.123456): the client reads it
-- truncated (…:00.123Z), so a write at …:00.123Z keeps it and a removal at …:00.124Z deletes it
select results_eq(
  $$
    select outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.save_write(3, '2026-01-10T12:00:00.123Z', 8))
    )
  $$,
  $$ values ('kept') $$,
  'a row at …:00.123456 is kept against a save at …:00.123Z'
);

select results_eq(
  $$
    select outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.remove_write(3, '2026-01-10T12:00:00.123Z'))
    )
  $$,
  $$ values ('kept') $$,
  'a row at …:00.123456 is kept against a removal at …:00.123Z'
);

select results_eq(
  $$
    select outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.remove_write(3, '2026-01-10T12:00:00.124Z'))
    )
  $$,
  $$ values ('written') $$,
  'a row at …:00.123456 is deleted by a removal at …:00.124Z'
);

select is_empty(
  $$ select * from public.replay_library_writes('00000000-0000-0000-0000-000000000001', '[]') $$,
  'an empty list answers no row'
);

-- the regular writes of the api are unchanged (060-library-updated-at): a delete still works
select results_eq(
  $$
    delete from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a007'
    returning external_id
  $$,
  $$ values (7) $$,
  'a regular delete of an own row still works'
);

-- other user: writes queued for the owner never land in their account, and their replay of the
-- owner's keys reaches their own rows only
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.save_write(30, '2026-01-15T08:00:00.000Z'))
    )
  $$,
  '42501',
  'not the expected user',
  'a call whose token is not the expected user is rejected'
);

select results_eq(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000002',
      jsonb_build_array(
        pg_temp.save_write(2, '2026-06-01T08:00:00.000Z', 26, 'Trigun (other)'),
        pg_temp.remove_write(4, '2026-06-01T08:00:00.000Z'),
        pg_temp.remove_write(6, '2026-06-01T08:00:00.000Z')
      )
    )
  $$,
  $$
    select 'mal'::public.media_id_namespace, 'anime'::public.media_kind, external_id,
      '00000000-0000-0000-0000-000000000002'::uuid, 'written'
    from (values (2), (4), (6)) as expected (external_id)
  $$,
  'another user''s replay of the owner''s keys answers for their own rows'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select user_id, media_title, progress
    from public.library_entries
    where external_id = 2
    order by user_id
  $$,
  $$
    values
      ('00000000-0000-0000-0000-000000000001'::uuid, 'Trigun', 3),
      ('00000000-0000-0000-0000-000000000002'::uuid, 'Trigun (other)', 26)
  $$,
  'another user''s save of the owner''s key writes their own row only'
);

select results_eq(
  $$
    select user_id, progress, updated_at
    from public.library_entries
    where external_id = 4
  $$,
  $$
    values (
      '00000000-0000-0000-0000-000000000001'::uuid, 6, '2026-01-10 12:00:00+00'::timestamptz
    )
  $$,
  'another user''s removal of a key the owner holds leaves the owner''s row'
);

select is_empty(
  $$ select user_id from public.library_entries where external_id = 6 $$,
  'another user''s removal deletes their own older row'
);

select is_empty(
  $$ select user_id from public.library_entries where external_id = 30 $$,
  'a call refused for its user writes nothing'
);

select * from finish();

rollback;
