-- library entries: full crud for the owner, nothing for another user or anon, server-controlled
-- columns (user_id, created_at) not writable, constraints for BR-01, BR-07 and the media snapshot
begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

-- setup as postgres: one backdated entry per user
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

insert into public.library_entries (
  id,
  user_id,
  media_kind,
  mal_id,
  media_title,
  media_format,
  media_total_units,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'anime', 1, 'Cowboy Bebop', 'TV', 26, '2000-01-01', '2000-01-01'
  ),
  (
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-000000000002',
    'manga', 5, 'Monster', 'Manga', 162, '2000-01-01', '2000-01-01'
  );

-- owner
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$
    insert into public.library_entries (
      media_kind, mal_id, media_title, media_format, media_image_url
    ) values ('anime', 2, 'Trigun', 'TV', 'https://cdn.myanimelist.net/images/anime/7/20310.jpg')
    returning user_id
  $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid) $$,
  'an entry inserted without user_id belongs to the signed-in user'
);

select results_eq(
  $$ select mal_id from public.library_entries order by mal_id $$,
  $$ values (1), (2) $$,
  'the owner reads their own entries only'
);

select results_eq(
  $$
    update public.library_entries
    set progress = 3
    where id = '00000000-0000-0000-0000-00000000a001'
    returning progress
  $$,
  $$ values (3) $$,
  'the owner updates the progress of their entry'
);

select ok(
  (
    select updated_at > '2000-01-01'::timestamptz
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  ),
  'an update bumps updated_at'
);

select results_eq(
  $$
    delete from public.library_entries
    where media_kind = 'anime' and mal_id = 2
    returning mal_id
  $$,
  $$ values (2) $$,
  'the owner deletes their own entry'
);

-- server-controlled columns have no insert or update grant
select throws_ok(
  $$
    insert into public.library_entries (user_id, media_kind, mal_id, media_title, media_format)
    values ('00000000-0000-0000-0000-000000000001', 'anime', 3, 'Akira', 'Movie')
  $$,
  '42501',
  null,
  'user_id cannot be set on insert, not even to the signed-in user'
);

select throws_ok(
  $$
    update public.library_entries
    set user_id = '00000000-0000-0000-0000-000000000002'
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'an entry cannot be handed to another user'
);

select throws_ok(
  $$
    update public.library_entries
    set created_at = '2000-01-01'
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'created_at cannot be set'
);

select throws_ok(
  $$
    update public.library_entries
    set updated_at = '2000-01-01'
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'updated_at cannot be set'
);

select throws_ok(
  $$
    insert into public.library_entries (id, media_kind, mal_id, media_title, media_format)
    values ('00000000-0000-0000-0000-00000000a0ff', 'anime', 4, 'Paprika', 'Movie')
  $$,
  '42501',
  null,
  'id cannot be chosen by the client'
);

-- BR-01: progress is >= 0, with no upper bound in the database
select throws_ok(
  $$
    update public.library_entries
    set progress = -1
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '23514',
  null,
  'BR-01: a negative progress is rejected'
);

select lives_ok(
  $$
    insert into public.library_entries (
      media_kind, mal_id, media_title, media_format, media_total_units, progress
    ) values ('anime', 20, 'Planetes', 'TV', 12, 13)
  $$,
  'BR-01: a progress above the snapshot total is accepted'
);

-- BR-07: score null or 1-10, notes up to 2000 characters
select throws_ok(
  $$
    update public.library_entries
    set score = 0
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '23514',
  null,
  'BR-07: a score of 0 is rejected'
);

select throws_ok(
  $$
    update public.library_entries
    set score = 11
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '23514',
  null,
  'BR-07: a score of 11 is rejected'
);

select lives_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, score)
    values ('anime', 21, 'Mushishi', 'TV', 10), ('anime', 22, 'Haibane Renmei', 'TV', null)
  $$,
  'BR-07: a score of 10 or null is accepted'
);

select lives_ok(
  $$
    update public.library_entries
    set score = 1
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  'BR-07: a score of 1 is accepted'
);

select throws_ok(
  $$
    update public.library_entries
    set notes = repeat('a', 2001)
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '23514',
  null,
  'BR-07: notes of 2001 characters are rejected'
);

select lives_ok(
  $$
    update public.library_entries
    set notes = repeat('a', 2000)
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  'BR-07: notes of 2000 characters are accepted'
);

-- media snapshot
select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 0, 'Zero', 'TV')
  $$,
  '23514',
  null,
  'a mal_id of 0 is rejected'
);

select lives_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 2147483647, 'Max', 'TV')
  $$,
  'the largest integer mal_id is accepted'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 2147483648, 'Overflow', 'TV')
  $$,
  '22003',
  null,
  'a mal_id above the integer range is rejected'
);

select throws_ok(
  $$
    update public.library_entries
    set media_image_url = 'http://cdn.myanimelist.net/images/anime/4/19644.jpg'
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '23514',
  null,
  'a non-https image url is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 23, '', 'TV')
  $$,
  '23514',
  null,
  'an empty media title is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, media_image_url)
    values ('anime', 25, repeat('a', 501), 'TV', null)
  $$,
  '23514',
  null,
  'a media title of 501 characters is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, media_image_url)
    values ('anime', 26, 'Kino', '', null)
  $$,
  '23514',
  null,
  'an empty media format is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, media_image_url)
    values ('anime', 27, 'Kino', repeat('a', 33), null)
  $$,
  '23514',
  null,
  'a media format of 33 characters is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, media_image_url)
    values ('anime', 28, 'Kino', 'TV', 'https://' || repeat('a', 2041))
  $$,
  '23514',
  null,
  'an image url of 2049 characters is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, media_total_units)
    values ('anime', 24, 'Kaiba', 'TV', 0)
  $$,
  '23514',
  null,
  'a media total of 0 units is rejected'
);

-- one entry per user and media
select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 1, 'Cowboy Bebop', 'TV')
  $$,
  '23505',
  null,
  'the same media cannot be added twice by the same user'
);

select lives_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('manga', 1, 'Cowboy Bebop', 'Manga')
  $$,
  'the same mal_id is accepted for the other media kind'
);

-- upsert as postgrest sends it: every payload column, media_kind and mal_id included, is in the
-- do update set list, so a narrower update grant would break the repository and the guest merge
select lives_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format, progress)
    values ('anime', 1, 'Cowboy Bebop', 'TV', 7)
    on conflict (user_id, media_kind, mal_id) do update
    set media_kind = excluded.media_kind,
      mal_id = excluded.mal_id,
      media_title = excluded.media_title,
      media_format = excluded.media_format,
      progress = excluded.progress
  $$,
  'the owner upserts an existing media'
);

select results_eq(
  $$ select id, progress from public.library_entries where media_kind = 'anime' and mal_id = 1 $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, 7) $$,
  'the upsert updates the existing entry instead of adding one'
);

-- other user
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 1, 'Cowboy Bebop', 'TV')
  $$,
  'the same media is accepted for another user'
);

select is_empty(
  $$ select id from public.library_entries where id = '00000000-0000-0000-0000-00000000a001' $$,
  'another user cannot read the owner''s entry'
);

select is_empty(
  $$
    update public.library_entries
    set progress = 10
    where id = '00000000-0000-0000-0000-00000000a001'
    returning id
  $$,
  'another user cannot update the owner''s entry'
);

select is_empty(
  $$
    delete from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
    returning id
  $$,
  'another user cannot delete the owner''s entry'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select user_id, progress
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid, 7) $$,
  'the owner''s entry still exists, unchanged'
);

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select id from public.library_entries $$,
  '42501',
  null,
  'anon cannot read entries'
);

select throws_ok(
  $$
    insert into public.library_entries (media_kind, mal_id, media_title, media_format)
    values ('anime', 3, 'Akira', 'Movie')
  $$,
  '42501',
  null,
  'anon cannot insert entries'
);

select throws_ok(
  $$
    update public.library_entries
    set progress = 10
    where id = '00000000-0000-0000-0000-00000000a001'
  $$,
  '42501',
  null,
  'anon cannot update entries'
);

select throws_ok(
  $$ delete from public.library_entries where id = '00000000-0000-0000-0000-00000000a001' $$,
  '42501',
  null,
  'anon cannot delete entries'
);

select * from finish();

rollback;
