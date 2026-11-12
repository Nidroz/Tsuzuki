-- per-user cap of library_entries (R-04): a user holds at most 10000 entries. an insert of a new
-- key past it is refused with TZ001 and a fixed message, through the api, the guest merge and the
-- replay alike, a call of either function then refused whole; a write of a key the user already
-- holds (an upsert, an update, a merge or replay of existing keys) keeps working at the cap. the
-- count is per user, and the trigger function is reachable by no api role
begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- a guest entry as the client sends it: every writable column and updated_at
create function pg_temp.guest_entry(external_id integer, updated_at text, progress integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id_namespace', 'mal',
    'media_kind', 'anime',
    'external_id', external_id,
    'media_title', 'Guest title',
    'media_image_url', null,
    'media_format', 'tv',
    'media_total_units', null,
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

-- a queued save as the client sends it: op, every writable column and the time of the change
create function pg_temp.save_write(external_id integer, updated_at text, progress integer)
returns jsonb
language sql
as $$ select pg_temp.guest_entry(external_id, updated_at, progress) || '{"op": "save"}' $$;

-- an insert of a new key as the api sends it, the user from the token
create function pg_temp.insert_sql(external_id integer)
returns text
language sql
as $$
  select format(
    $sql$
      insert into public.library_entries (
        id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
      ) values ('mal', 'anime', %s, 'Added title', 'tv', false)
    $sql$,
    external_id
  )
$$;

-- the function

select ok(
  not has_function_privilege('anon', 'private.enforce_library_entry_cap()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_library_entry_cap()', 'execute')
  and not has_function_privilege('public', 'private.enforce_library_entry_cap()', 'execute'),
  'nobody but its owner executes private.enforce_library_entry_cap'
);

-- setup as postgres: the owner one entry short of the cap (keys 1 to 9999), seeded without the
-- trigger, which counts the user's rows on each insert; the other user holds three entries
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

alter table public.library_entries disable trigger library_entries_enforce_cap;

insert into public.library_entries (
  user_id, id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
  updated_at
)
select
  '00000000-0000-0000-0000-000000000001', 'mal', 'anime', item, 'Seeded title', 'tv', false,
  '2026-01-10 12:00:00+00'
from generate_series(1, 9999) as item;

alter table public.library_entries enable trigger library_entries_enforce_cap;

insert into public.library_entries (
  user_id, id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
)
select '00000000-0000-0000-0000-000000000002', 'mal', 'anime', item, 'Other title', 'tv', false
from generate_series(1, 3) as item;

-- owner: the api
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- one statement of two new keys at 9999 entries: the trigger of its second row sees the first row
-- (a volatile function sees the rows its statement already inserted), so the statement is refused
-- whole; the next case proves the first row was not kept (its key inserts again)
select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values
      ('mal', 'anime', 10000, 'Added title', 'tv', false),
      ('mal', 'anime', 10001, 'Added title', 'tv', false)
  $$,
  'TZ001',
  'library entry limit reached',
  'a two-row insert crossing the cap is refused whole with TZ001'
);

select lives_ok(
  pg_temp.insert_sql(10000),
  'the 10000th entry is inserted, the other user''s entries not counted'
);

select throws_ok(
  pg_temp.insert_sql(10001),
  'TZ001',
  'library entry limit reached',
  'the 10001st entry is refused with TZ001'
);

-- an upsert of an existing key as postgrest sends it
select results_eq(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult, progress
    ) values ('mal', 'anime', 5, 'Seeded title', 'tv', false, 7)
    on conflict (user_id, id_namespace, media_kind, external_id) do update
    set id_namespace = excluded.id_namespace,
      media_kind = excluded.media_kind,
      external_id = excluded.external_id,
      media_title = excluded.media_title,
      media_format = excluded.media_format,
      media_is_adult = excluded.media_is_adult,
      progress = excluded.progress
    returning external_id, progress
  $$,
  $$ values (5, 7) $$,
  'an upsert of an existing key passes at the cap'
);

select results_eq(
  $$
    update public.library_entries
    set notes = 'rewatch'
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 6
    returning external_id, notes
  $$,
  $$ values (6, 'rewatch') $$,
  'an update of an existing key passes at the cap'
);

-- the guest merge at the cap: the existing key first, so its write is rolled back with the call
select throws_ok(
  $$
    select * from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(1, '2026-02-01T08:00:00.000Z', 11),
      pg_temp.guest_entry(20001, '2026-02-01T08:00:00.000Z', 1)
    ))
  $$,
  'TZ001',
  'library entry limit reached',
  'a merge holding a new key is refused whole at the cap'
);

select results_eq(
  $$
    select external_id, outcome
    from public.merge_guest_library_entries(jsonb_build_array(
      pg_temp.guest_entry(2, '2026-02-01T08:00:00.000Z', 12),
      pg_temp.guest_entry(3, '2026-01-01T08:00:00.000Z', 13)
    ))
  $$,
  $$ values (2, 'written'), (3, 'kept') $$,
  'a merge of existing keys passes at the cap'
);

-- the replay at the cap, likewise
select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(
        pg_temp.save_write(4, '2026-02-01T08:00:00.000Z', 14),
        pg_temp.save_write(20002, '2026-02-01T08:00:00.000Z', 1)
      )
    )
  $$,
  'TZ001',
  'library entry limit reached',
  'a replay holding a new key is refused whole at the cap'
);

select results_eq(
  $$
    select external_id, outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.save_write(7, '2026-02-01T08:00:00.000Z', 17))
    )
  $$,
  $$ values (7, 'written') $$,
  'a replay of existing keys passes at the cap'
);

-- the other user, while the owner is at the cap
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  pg_temp.insert_sql(10001),
  'another user inserts while the owner is at the cap'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select external_id, progress
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id in (1, 2, 3, 4, 7)
    order by external_id
  $$,
  $$ values (1, 0), (2, 12), (3, 0), (4, 0), (7, 17) $$,
  'a refused merge or replay writes none of its entries, an accepted one writes its newer ones'
);

select is_empty(
  $$
    select external_id
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id > 10000
  $$,
  'no new key is stored for the owner past the cap'
);

select results_eq(
  $$
    select user_id, pg_catalog.count(*)::integer
    from public.library_entries
    group by user_id
    order by user_id
  $$,
  $$
    values
      ('00000000-0000-0000-0000-000000000001'::uuid, 10000),
      ('00000000-0000-0000-0000-000000000002'::uuid, 4)
  $$,
  'the owner holds exactly 10000 entries, the other user their own'
);

select * from finish();

rollback;
