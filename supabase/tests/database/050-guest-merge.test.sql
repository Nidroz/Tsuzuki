-- guest merge (BR-08, ADR-0016): public.merge_guest_library_entries, the only function the api
-- calls. security definer with a pinned search_path, executable by authenticated only, the user
-- from auth.uid() only. each entry keeps its own updated_at capped at now(); a strictly newer one
-- replaces the stored copy, an equal or older one keeps it, the microsecond updated_at compared
-- with the millisecond guest time as the client compares the truncated value. two devices merging
-- the same media keep the most recent change whatever their order. a batch is validated whole and
-- written whole or not at all, updated_at in the rfc 3339 form only and no earlier than the year
-- 1; another user's rows are out of reach
begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

-- a guest entry as the client sends it: every writable column and updated_at
create function pg_temp.guest_entry(
  external_id integer,
  updated_at text,
  progress integer default 0,
  media_title text default 'Guest title'
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
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

-- the function

select is_definer(
  'public', 'merge_guest_library_entries', array['jsonb'],
  'merge_guest_library_entries is security definer'
);

select ok(
  (
    select proconfig = array['search_path=""']
    from pg_catalog.pg_proc
    where oid = 'public.merge_guest_library_entries(jsonb)'::regprocedure
  ),
  'merge_guest_library_entries pins an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.merge_guest_library_entries(jsonb)', 'execute')
  and not has_function_privilege('public', 'public.merge_guest_library_entries(jsonb)', 'execute'),
  'anon and public cannot execute merge_guest_library_entries'
);

select ok(
  has_function_privilege('authenticated', 'public.merge_guest_library_entries(jsonb)', 'execute'),
  'authenticated can execute merge_guest_library_entries'
);

select ok(
  not has_function_privilege('anon', 'private.write_client_library_entry(jsonb)', 'execute')
  and not has_function_privilege(
    'authenticated', 'private.write_client_library_entry(jsonb)', 'execute'
  )
  and not has_function_privilege('public', 'private.write_client_library_entry(jsonb)', 'execute'),
  'nobody but its owner executes the helper private.write_client_library_entry'
);

select isnt_definer(
  'private', 'write_client_library_entry', array['jsonb'],
  'the helper runs with the rights of its caller'
);

-- setup as postgres: entries of the owner at fixed past times, one with microseconds
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format,
  media_is_adult, progress, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 1, 'Cowboy Bebop', 'tv', false, 5,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 2, 'Trigun', 'tv', false, 3,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 3, 'Planetes', 'tv', false, 4,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00.123456+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 4, 'Mushishi', 'tv', false, 6,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 5, 'Kaiba', 'tv', false, 1,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  );

-- callers

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select * from public.merge_guest_library_entries('[]'::jsonb) $$,
  '42501',
  null,
  'anon cannot call the merge'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$ select * from public.merge_guest_library_entries('[]'::jsonb) $$,
  '42501',
  'not authenticated',
  'a call without a user is rejected'
);

-- owner: newer local (1), older local (2), equal (4), new (10), new in the future (11)
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(1, '2026-01-20T08:00:00.000Z', 9, 'Cowboy Bebop (guest)'),
      pg_temp.guest_entry(2, '2026-01-05T08:00:00.000Z', 26, 'Trigun (guest)'),
      pg_temp.guest_entry(4, '2026-01-10T12:00:00.000Z', 7, 'Mushishi (guest)'),
      pg_temp.guest_entry(10, '2026-01-15T08:00:00.000Z', 2),
      pg_temp.guest_entry(11, '2100-01-01T00:00:00.000Z', 1)
    ))
  $$,
  $$
    select 'mal'::public.media_id_namespace, 'anime'::public.media_kind, external_id,
      '00000000-0000-0000-0000-000000000001'::uuid, outcome
    from (values (1, 'written'), (2, 'kept'), (4, 'kept'), (10, 'written'), (11, 'written'))
      as expected (external_id, outcome)
  $$,
  'the merge answers one row per entry, in order: the key, the caller and the outcome'
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
      'Cowboy Bebop (guest)', 9,
      '2026-01-01 00:00:00+00'::timestamptz, '2026-01-20 08:00:00+00'::timestamptz
    )
  $$,
  'a newer local entry replaces the values, takes the local time and keeps created_at'
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
  'a stored copy newer than or as recent as the local one is kept unchanged'
);

select results_eq(
  $$
    select user_id, progress, created_at = now(), updated_at
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 10
  $$,
  $$
    values (
      '00000000-0000-0000-0000-000000000001'::uuid, 2, true,
      '2026-01-15 08:00:00+00'::timestamptz
    )
  $$,
  'a new entry is inserted for the caller with its own time, created now'
);

select ok(
  (
    select updated_at = now()
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 11
  ),
  'a future time is capped to now on insert'
);

select results_eq(
  $$
    select entry_id, from_progress, to_progress
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, 5, 9) $$,
  'a replace changing the progress logs one progress event, an insert none'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(5, '2100-01-01T00:00:00.000Z', 2)
    ))
  $$,
  $$ values ('written') $$,
  'a future time replaces an older stored copy'
);

select ok(
  (
    select updated_at = now()
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a005'
  ),
  'a future time is capped to now on replace'
);

-- millisecond guest times against a microsecond updated_at (…:00.123456): the client reads it
-- truncated (…:00.123Z), so the server keeps a guest …:00.123Z and replaces with …:00.124Z
select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(3, '2026-01-10T12:00:00.123Z', 8)
    ))
  $$,
  $$ values ('kept') $$,
  'a row at …:00.123456 is kept against a guest time of …:00.123Z'
);

select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(3, '2026-01-10T12:00:00.124Z', 8)
    ))
  $$,
  $$ values ('written') $$,
  'a row at …:00.123456 is replaced by a guest time of …:00.124Z'
);

select results_eq(
  $$
    select progress, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a003'
  $$,
  $$ values (8, '2026-01-10 12:00:00.124+00'::timestamptz) $$,
  'the replaced row holds the guest time of …:00.124Z'
);

-- two devices with guest data for the same media (20: the older change first, 21: the newer
-- change first): the most recent change wins whatever the order of the sign ins
select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(20, '2026-02-01T08:00:00.000Z', 2, 'First device')
    ))
    union all
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(20, '2026-02-05T08:00:00.000Z', 7, 'Second device')
    ))
  $$,
  $$ values ('written'), ('written') $$,
  'the second device''s newer change replaces the first device''s'
);

select results_eq(
  $$
    select media_title, progress, updated_at
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 20
  $$,
  $$ values ('Second device', 7, '2026-02-05 08:00:00+00'::timestamptz) $$,
  'the newer change and its time win when merged second'
);

select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(21, '2026-02-05T08:00:00.000Z', 7, 'Second device')
    ))
    union all
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(21, '2026-02-01T08:00:00.000Z', 2, 'First device')
    ))
  $$,
  $$ values ('written'), ('kept') $$,
  'an older change merged after a newer one is kept out'
);

select results_eq(
  $$
    select media_title, progress, updated_at
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 21
  $$,
  $$ values ('Second device', 7, '2026-02-05 08:00:00+00'::timestamptz) $$,
  'the newer change and its time win when merged first'
);

-- input: bounded, an array of objects of exactly the expected keys, each key once
select is(
  (
    select pg_catalog.count(*)::integer
    from public.merge_guest_library_entries(
      (
        select jsonb_agg(pg_temp.guest_entry(1000 + item, '2026-01-15T08:00:00.000Z'))
        from generate_series(1, 100) as item
      )
    )
  ),
  100,
  'a batch of 100 entries is merged'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(
      (
        select jsonb_agg(pg_temp.guest_entry(2000 + item, '2026-01-15T08:00:00.000Z'))
        from generate_series(1, 101) as item
      )
    )
  $$,
  '22023',
  'too many entries',
  'a batch of 101 entries is rejected'
);

select throws_ok(
  $$ select * from public.merge_guest_library_entries('{}'::jsonb) $$,
  '22023',
  'entries must be a json array',
  'entries that are not an array are rejected'
);

select throws_ok(
  $$ select * from public.merge_guest_library_entries('[1]'::jsonb) $$,
  '22023',
  'an entry is not a json object',
  'an entry that is not an object is rejected'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(30, '2026-01-15T08:00:00.000Z') - 'notes'
    ))
  $$,
  '22023',
  'an entry does not hold exactly the expected keys',
  'an entry missing a key is rejected'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(30, '2026-01-15T08:00:00.000Z')
        || '{"created_at": "2026-01-01T00:00:00.000Z"}'
    ))
  $$,
  '22023',
  'an entry does not hold exactly the expected keys',
  'an entry with an extra key is rejected'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(30, '2026-01-15T08:00:00.000Z'),
      pg_temp.guest_entry(30, '2026-01-16T08:00:00.000Z')
    ))
  $$,
  '22023',
  'entries hold a key twice',
  'a key twice is rejected'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(30, null)
    ))
  $$,
  '22023',
  'an entry has no updated_at string',
  'a null updated_at is rejected'
);

-- updated_at in the rfc 3339 form only, checked before any cast: strings postgres would read as
-- a time are refused, and the valid entry of each batch is not written either
select throws_ok(
  format(
    $$
      select * from public.merge_guest_library_entries(jsonb_build_array(
        pg_temp.guest_entry(%s, '2026-01-15T08:00:00.000Z'),
        pg_temp.guest_entry(%s, %L)
      ))
    $$,
    probe.external_id, probe.external_id + 1, probe.updated_at
  ),
  '22023',
  'an entry has no rfc 3339 updated_at',
  format('an updated_at of %s is rejected', probe.label)
)
from (
  values
    (40, 'infinity', 'infinity'),
    (42, '-infinity', '-infinity'),
    (44, '0044-03-15 00:00:00+00 BC', 'a BC date'),
    (46, 'epoch', 'epoch'),
    (48, 'now', 'now'),
    (50, '1/2/2026', 'a DateStyle-dependent date')
) as probe (external_id, updated_at, label);

-- a valid form whose offset reaches before the year 1 in utc is refused after the cast: the
-- batch's first entry, already written, is rolled back with it
select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(52, '2026-01-15T08:00:00.000Z'),
      pg_temp.guest_entry(53, '0001-01-01T00:00:00+01:00')
    ))
  $$,
  '22023',
  'updated_at must not be before the year 1',
  'a time before the year 1 in utc is rejected'
);

select results_eq(
  $$
    select outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(54, '0001-01-01T00:00:00.000Z')
    ))
  $$,
  $$ values ('written') $$,
  'the first instant of the year 1 is written'
);

-- the key as the table types it: a number and a numeric string are one external_id
select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(30, '2026-01-15T08:00:00.000Z'),
      pg_temp.guest_entry(30, '2026-01-16T08:00:00.000Z') || '{"external_id": "30"}'
    ))
  $$,
  '22023',
  'entries hold a key twice',
  'a key spelled as a number and as a string is rejected as a key twice'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(31, '2026-01-15T08:00:00.000Z'),
      pg_temp.guest_entry(32, '2026-01-15T08:00:00.000Z', -1)
    ))
  $$,
  '23514',
  null,
  'a batch with an entry outside the constraints is rejected'
);

-- other user: the merge of a guest who signed in as another account
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(1, '2026-06-01T08:00:00.000Z', 26, 'Cowboy Bebop (other)')
    ))
  $$,
  $$
    values (
      'mal'::public.media_id_namespace, 'anime'::public.media_kind, 1,
      '00000000-0000-0000-0000-000000000002'::uuid, 'written'
    )
  $$,
  'another user''s merge of the owner''s key writes their own row'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(1, '2026-07-01T08:00:00.000Z')
        || '{"user_id": "00000000-0000-0000-0000-000000000001"}'
    ))
  $$,
  '22023',
  'an entry does not hold exactly the expected keys',
  'an entry naming a user is rejected'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select user_id, media_title, progress, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      '00000000-0000-0000-0000-000000000001'::uuid, 'Cowboy Bebop (guest)', 9,
      '2026-01-20 08:00:00+00'::timestamptz
    )
  $$,
  'the owner''s row is unchanged by the other user''s merge'
);

select results_eq(
  $$
    select user_id, progress
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
    order by user_id
  $$,
  $$
    values
      ('00000000-0000-0000-0000-000000000001'::uuid, 9),
      ('00000000-0000-0000-0000-000000000002'::uuid, 26)
  $$,
  'each user has their own row of the key'
);

-- the private rule checks the form itself, for its other callers (A-05): a time postgres would
-- read, and a null one, are refused before any cast
select throws_ok(
  format(
    $$ select private.write_client_library_entry(pg_temp.guest_entry(%s, %L)) $$,
    probe.external_id, probe.updated_at
  ),
  '22023',
  'updated_at must be an rfc 3339 timestamp',
  format('the private rule refuses an updated_at of %s', probe.label)
)
from (
  values
    (56, 'epoch', 'epoch'),
    (57, null, 'null')
) as probe (external_id, updated_at, label);

select is(
  (
    select to_jsonb(updated_at) #>> '{}'
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id = 54
  ),
  '0001-01-01T00:00:00+00:00',
  'the first instant of the year 1 is stored and served without a BC suffix'
);

select is_empty(
  $$
    select external_id
    from public.library_entries
    where external_id in (30, 31, 32)
      or external_id between 40 and 53
      or external_id in (56, 57)
      or external_id > 2000
  $$,
  'a rejected batch writes none of its entries'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id between 1001 and 1100
  ),
  100,
  'the batch of 100 entries is stored for the owner'
);

select * from finish();

rollback;
