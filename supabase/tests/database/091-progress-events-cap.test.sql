-- per-user cap of progress_events (R-04): a user keeps the 10000 most recent events, in the order
-- (created_at desc, id desc). each new event deletes that user's older ones and never fails, so a
-- progress change through the api still succeeds at the cap; another user's events are never
-- touched, and a user over the cap from before is trimmed by their next event. the trigger
-- function is reachable by no api role
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- the function

select ok(
  not has_function_privilege('anon', 'private.trim_progress_events()', 'execute')
  and not has_function_privilege('authenticated', 'private.trim_progress_events()', 'execute')
  and not has_function_privilege('public', 'private.trim_progress_events()', 'execute'),
  'nobody but its owner executes private.trim_progress_events'
);

select has_index(
  'public', 'progress_events', 'progress_events_user_created_id_idx',
  array['user_id', 'created_at', 'id'],
  'the events have the index of the trim order'
);

-- setup as postgres: one entry per user; the owner holds 10000 events, one a minute up to a minute
-- ago, the other user 10002 events, all older than the owner's: a trim across users would take
-- theirs first. seeded without the trigger, which reads the user's events on each insert
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
) values
  (
    '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 1, 'Cowboy Bebop', 'tv', false
  ),
  (
    '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000002',
    'mal', 'anime', 1, 'Cowboy Bebop', 'tv', false
  );

alter table public.progress_events disable trigger progress_events_trim;

insert into public.progress_events (entry_id, user_id, from_progress, to_progress, created_at)
select
  '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 0, item,
  now() - (10001 - item) * interval '1 minute'
from generate_series(1, 10000) as item;

insert into public.progress_events (entry_id, user_id, from_progress, to_progress, created_at)
select
  '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000002', 0, item,
  now() - interval '1 year' - (10003 - item) * interval '1 minute'
from generate_series(1, 10002) as item;

alter table public.progress_events enable trigger progress_events_trim;

-- owner: a progress change through the api at the cap
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    update public.library_entries
    set progress = 1
    where id = '00000000-0000-0000-0000-00000000a001'
    returning progress
  $$,
  $$ values (1) $$,
  'a progress change at the cap succeeds'
);

-- verification as postgres
reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  10000,
  'the owner keeps 10000 events'
);

select results_eq(
  $$
    select pg_catalog.min(to_progress), pg_catalog.max(created_at) = now()
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001' and from_progress = 0
      and created_at < now()
    union all
    select pg_catalog.count(*)::integer, pg_catalog.bool_and(created_at = now())
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001' and created_at = now()
  $$,
  $$ values (2, false), (1, true) $$,
  'the oldest event is dropped and the new one, the most recent, kept'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000002'
  ),
  10002,
  'the other user''s events are untouched, older ones included'
);

-- the other user, over the cap from before: their next event trims them to the cap
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    update public.library_entries
    set progress = 1
    where id = '00000000-0000-0000-0000-00000000b001'
  $$,
  'a progress change over the cap succeeds'
);

reset role;

select results_eq(
  $$
    select pg_catalog.count(*)::integer, pg_catalog.min(to_progress)
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000002' and created_at < now()
  $$,
  $$ values (9999, 4) $$,
  'the next event of a user over the cap drops every event past the 10000 most recent'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  ),
  10000,
  'the owner''s events are untouched by the other user''s trim'
);

select * from finish();

rollback;
