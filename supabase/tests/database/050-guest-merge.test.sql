-- guest merge (BR-08, ADR-0016): the database behaviour the client merge relies on, in the statement
-- shapes postgrest sends for it. an insert on conflict do nothing never overwrites and returns the
-- inserted rows only; an update filtered on the user, the key and updated_at < the guest time
-- applies the newest-wins rule to the row as it is at the write, the trigger stamping updated_at;
-- the microsecond updated_at compares with a millisecond guest time as the client compares the
-- truncated value; another user's rows are out of reach, and anon has no access
begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- setup as postgres: three entries of the owner at fixed times, the third with microseconds
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id,
  user_id,
  id_namespace,
  media_kind,
  external_id,
  media_title,
  media_format,
  media_total_units,
  media_is_adult,
  status,
  progress,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 1, 'Cowboy Bebop', 'TV', 26, false, 'current', 5,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a002',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 2, 'Trigun', 'TV', 26, false, 'current', 3,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-00000000a003',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 3, 'Planetes', 'TV', 26, false, 'current', 4,
    '2026-01-01 00:00:00+00', '2026-01-10 12:00:00.123456+00'
  );

-- owner: the insert of the entries the account lacks, as supabase-js upsert(payloads,
-- { onConflict, ignoreDuplicates: true }) sends it. never user_id, created_at or updated_at
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_image_url, media_format,
      media_total_units, media_is_adult, status, progress, score, notes, is_favorite, started_at,
      finished_at
    ) values
      (
        'mal', 'anime', 10, 'Mushishi', null, 'TV',
        26, false, 'current', 2, null, null, false, null,
        null
      ),
      (
        'mal', 'anime', 1, 'Cowboy Bebop (guest)', null, 'TV',
        26, false, 'completed', 26, 9, 'guest notes', true, '2026-01-02',
        '2026-01-09'
      )
    on conflict (user_id, id_namespace, media_kind, external_id) do nothing
    returning id_namespace, media_kind, external_id, user_id
  $$,
  $$
    values (
      'mal'::public.media_id_namespace,
      'anime'::public.media_kind,
      10,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  $$,
  'the merge insert returns the new row only, owned by the signed-in user'
);

select results_eq(
  $$
    select media_title, status, progress, score, notes, is_favorite, created_at, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      'Cowboy Bebop',
      'current'::public.library_status,
      5,
      null::smallint,
      null::text,
      false,
      '2026-01-01 00:00:00+00'::timestamptz,
      '2026-01-10 12:00:00+00'::timestamptz
    )
  $$,
  'the merge insert leaves the existing row of a key unchanged, updated_at included'
);

select ok(
  (
    select created_at = now() and updated_at = now()
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 10
  ),
  'an inserted row takes the merge time as created_at and updated_at'
);

-- verification as postgres
reset role;

select is_empty(
  $$
    select id
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  $$,
  'the merge insert writes no progress event'
);

-- owner: the conditional update of an entry whose guest copy is newer, as supabase-js
-- update(values).eq(user_id).eq(key).lt(updated_at, guest) sends it. never a key column
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    update public.library_entries
    set media_title = 'Trigun', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'completed', progress = 26,
      score = 8, notes = 'guest notes', is_favorite = true, started_at = '2026-01-02',
      finished_at = '2026-01-15'
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 2
      and updated_at < '2026-01-20T00:00:00.000Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  $$
    values (
      'mal'::public.media_id_namespace,
      'anime'::public.media_kind,
      2,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  $$,
  'a later guest time updates the row of its key'
);

select results_eq(
  $$
    select status, progress, score, notes, is_favorite, finished_at, created_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a002'
  $$,
  $$
    values (
      'completed'::public.library_status,
      26,
      8::smallint,
      'guest notes',
      true,
      '2026-01-15'::date,
      '2026-01-01 00:00:00+00'::timestamptz
    )
  $$,
  'the replaced row holds the guest values and keeps its created_at'
);

select ok(
  (
    select updated_at = now()
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a002'
  ),
  'the trigger sets the updated_at of the replaced row to the merge time'
);

select is_empty(
  $$
    update public.library_entries
    set media_title = 'Cowboy Bebop (guest)', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'completed', progress = 26,
      score = 9, notes = 'guest notes', is_favorite = true, started_at = '2026-01-02',
      finished_at = '2026-01-09'
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
      and updated_at < '2026-01-10T12:00:00.000Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  'a guest time equal to the row''s matches no row'
);

select is_empty(
  $$
    update public.library_entries
    set media_title = 'Cowboy Bebop (guest)', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'completed', progress = 26,
      score = 9, notes = 'guest notes', is_favorite = true, started_at = '2026-01-02',
      finished_at = '2026-01-09'
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
      and updated_at < '2026-01-09T00:00:00.000Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  'a guest time earlier than the row''s matches no row'
);

-- millisecond guest times against a microsecond updated_at (…:00.123456): the client reads it
-- truncated (…:00.123Z), so the server must keep a guest …:00.123Z and replace with …:00.124Z
select is_empty(
  $$
    update public.library_entries
    set media_title = 'Planetes', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'paused', progress = 4,
      score = null, notes = null, is_favorite = false, started_at = null, finished_at = null
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 3
      and updated_at < '2026-01-10T12:00:00.123Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  'a row at …:00.123456 is not matched by updated_at < …:00.123Z'
);

select results_eq(
  $$
    update public.library_entries
    set media_title = 'Planetes', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'paused', progress = 4,
      score = null, notes = null, is_favorite = false, started_at = null, finished_at = null
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 3
      and updated_at < '2026-01-10T12:00:00.124Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  $$
    values (
      'mal'::public.media_id_namespace,
      'anime'::public.media_kind,
      3,
      '00000000-0000-0000-0000-000000000001'::uuid
    )
  $$,
  'a row at …:00.123456 is matched by updated_at < …:00.124Z'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select entry_id, from_progress, to_progress
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  $$,
  $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, 3, 26) $$,
  'a replace logs one progress event when the progress changed, none when it did not'
);

select results_eq(
  $$
    select status, progress, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      'current'::public.library_status,
      5,
      '2026-01-10 12:00:00+00'::timestamptz
    )
  $$,
  'an update with an equal or earlier guest time changes nothing'
);

-- other user: the merge of a guest who signed in as another account
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is_empty(
  $$
    update public.library_entries
    set media_title = 'Cowboy Bebop (guest)', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'completed', progress = 26,
      score = 9, notes = 'guest notes', is_favorite = true, started_at = '2026-01-02',
      finished_at = '2026-01-09'
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
      and updated_at < '2026-06-01T00:00:00.000Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  'another user''s update with the owner''s id and key matches no row'
);

select results_eq(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_image_url, media_format,
      media_total_units, media_is_adult, status, progress, score, notes, is_favorite, started_at,
      finished_at
    ) values (
      'mal', 'anime', 1, 'Cowboy Bebop (guest)', null, 'TV',
      26, false, 'completed', 26, 9, 'guest notes', true, '2026-01-02',
      '2026-01-09'
    )
    on conflict (user_id, id_namespace, media_kind, external_id) do nothing
    returning id_namespace, media_kind, external_id, user_id
  $$,
  $$
    values (
      'mal'::public.media_id_namespace,
      'anime'::public.media_kind,
      1,
      '00000000-0000-0000-0000-000000000002'::uuid
    )
  $$,
  'another user''s merge insert of the owner''s key creates their own row'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select user_id, media_title, status, progress, notes, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      '00000000-0000-0000-0000-000000000001'::uuid,
      'Cowboy Bebop',
      'current'::public.library_status,
      5,
      null::text,
      '2026-01-10 12:00:00+00'::timestamptz
    )
  $$,
  'the owner''s row is unchanged by the other user''s merge'
);

select results_eq(
  $$
    select user_id
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
    order by user_id
  $$,
  $$
    values
      ('00000000-0000-0000-0000-000000000001'::uuid),
      ('00000000-0000-0000-0000-000000000002'::uuid)
  $$,
  'each user has their own row of the key'
);

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_image_url, media_format,
      media_total_units, media_is_adult, status, progress, score, notes, is_favorite, started_at,
      finished_at
    ) values (
      'mal', 'anime', 11, 'Kaiba', null, 'TV',
      12, false, 'planned', 0, null, null, false, null,
      null
    )
    on conflict (user_id, id_namespace, media_kind, external_id) do nothing
    returning id_namespace, media_kind, external_id, user_id
  $$,
  '42501',
  null,
  'anon cannot run the merge insert'
);

select throws_ok(
  $$
    update public.library_entries
    set media_title = 'Cowboy Bebop (guest)', media_image_url = null, media_format = 'TV',
      media_total_units = 26, media_is_adult = false, status = 'completed', progress = 26,
      score = 9, notes = 'guest notes', is_favorite = true, started_at = '2026-01-02',
      finished_at = '2026-01-09'
    where user_id = '00000000-0000-0000-0000-000000000001'
      and id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
      and updated_at < '2026-06-01T00:00:00.000Z'
    returning id_namespace, media_kind, external_id, user_id
  $$,
  '42501',
  null,
  'anon cannot run the merge update'
);

select * from finish();

rollback;
