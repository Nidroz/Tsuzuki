-- progress events: written only by the progress trigger on a real progress change, read by their
-- owner only, never written through the api, deleted with their entry and with their user
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- setup as postgres
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id, user_id, media_kind, mal_id, media_title, media_format, media_total_units
) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'anime', 1, 'Cowboy Bebop', 'TV', 26
  ),
  (
    '00000000-0000-0000-0000-00000000a002',
    '00000000-0000-0000-0000-000000000001',
    'anime', 2, 'Trigun', 'TV', 26
  ),
  (
    '00000000-0000-0000-0000-00000000a003',
    '00000000-0000-0000-0000-000000000001',
    'manga', 1, 'Cowboy Bebop', 'Manga', 3
  ),
  (
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-000000000002',
    'manga', 5, 'Monster', 'Manga', 162
  );

-- the other user gets one event, so the owner's reads below can prove it stays hidden
update public.library_entries
set progress = 1
where id = '00000000-0000-0000-0000-00000000b001';

-- owner changes: a progress change, a notes-only change, a same-progress write, an insert
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

update public.library_entries
set progress = 3
where id = '00000000-0000-0000-0000-00000000a001';

select isnt_empty(
  $$
    update public.library_entries
    set notes = 'rewatch with subtitles'
    where id = '00000000-0000-0000-0000-00000000a002'
    returning id
  $$,
  'the notes-only write matches the entry'
);

select isnt_empty(
  $$
    update public.library_entries
    set progress = 0
    where id = '00000000-0000-0000-0000-00000000a003'
    returning id
  $$,
  'the same-progress write matches the entry'
);

insert into public.library_entries (media_kind, mal_id, media_title, media_format, progress)
values ('manga', 2, 'Monster', 'Manga', 5);

-- verification as postgres
reset role;

select results_eq(
  $$
    select entry_id, user_id, from_progress, to_progress
    from public.progress_events
    where entry_id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$
    values (
      '00000000-0000-0000-0000-00000000a001'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      0,
      3
    )
  $$,
  'a progress change writes exactly one event'
);

select is_empty(
  $$
    select id
    from public.progress_events
    where entry_id = '00000000-0000-0000-0000-00000000a002'
  $$,
  'a notes-only update writes no event'
);

select is_empty(
  $$
    select id
    from public.progress_events
    where entry_id = '00000000-0000-0000-0000-00000000a003'
  $$,
  'setting the same progress writes no event'
);

select is_empty(
  $$
    select e.id
    from public.progress_events e
    join public.library_entries l on l.id = e.entry_id
    where l.user_id = '00000000-0000-0000-0000-000000000001'
      and l.media_kind = 'manga'
      and l.mal_id = 2
  $$,
  'an insert writes no event, whatever its progress'
);

-- owner
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select entry_id from public.progress_events $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid) $$,
  'the owner reads their own events only'
);

select throws_ok(
  $$
    insert into public.progress_events (entry_id, user_id, from_progress, to_progress)
    values (
      '00000000-0000-0000-0000-00000000a001',
      '00000000-0000-0000-0000-000000000001',
      3,
      26
    )
  $$,
  '42501',
  null,
  'events cannot be inserted through the api'
);

select throws_ok(
  $$
    update public.progress_events
    set to_progress = 26
    where entry_id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'events cannot be updated through the api'
);

select throws_ok(
  $$
    delete from public.progress_events
    where entry_id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'events cannot be deleted through the api'
);

-- other user
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is_empty(
  $$
    select id
    from public.progress_events
    where user_id = '00000000-0000-0000-0000-000000000001'
  $$,
  'another user cannot read the owner''s events'
);

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select id from public.progress_events $$,
  '42501',
  null,
  'anon cannot read events'
);

-- cascade from the entry: the owner deletes it through the api, without any grant on events
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    delete from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
    returning id
  $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid) $$,
  'the owner deletes an entry that has events'
);

reset role;

select is_empty(
  $$
    select id
    from public.progress_events
    where entry_id = '00000000-0000-0000-0000-00000000a001'
  $$,
  'deleting an entry deletes its events'
);

-- cascade from the user, as postgres: the other user has a profile, an entry and an event
select results_eq(
  $$
    select
      (select count(*) from public.profiles where id = u.id),
      (select count(*) from public.library_entries where user_id = u.id),
      (select count(*) from public.progress_events where user_id = u.id)
    from (values ('00000000-0000-0000-0000-000000000002'::uuid)) as u (id)
  $$,
  $$ values (1::bigint, 1::bigint, 1::bigint) $$,
  'before deletion, the user has a profile, an entry and an event'
);

delete from auth.users where id = '00000000-0000-0000-0000-000000000002';

select results_eq(
  $$
    select
      (select count(*) from public.profiles where id = u.id),
      (select count(*) from public.library_entries where user_id = u.id),
      (select count(*) from public.progress_events where user_id = u.id)
    from (values ('00000000-0000-0000-0000-000000000002'::uuid)) as u (id)
  $$,
  $$ values (0::bigint, 0::bigint, 0::bigint) $$,
  'deleting a user deletes their profile, entries and events'
);

select * from finish();

rollback;
