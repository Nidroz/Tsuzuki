-- library entries: full crud for the owner, nothing for another user or anon, server-controlled
-- columns (user_id, created_at) not writable, the media identity (id_namespace, media_kind,
-- external_id), the adult flag (no default, BR-06), constraints for BR-01, BR-07 and the media
-- snapshot. every insert names id_namespace and media_is_adult, which have no default
begin;

create extension if not exists pgtap with schema extensions;

select plan(57);

-- media identity: mal_id is gone, every write names its id namespace
select hasnt_column(
  'public', 'library_entries', 'mal_id',
  'library_entries has no mal_id column anymore'
);

select has_column(
  'public', 'library_entries', 'id_namespace',
  'library_entries has an id_namespace column'
);

select col_type_is(
  'public', 'library_entries', 'id_namespace', 'public', 'media_id_namespace',
  'id_namespace is a media_id_namespace'
);

select col_not_null(
  'public', 'library_entries', 'id_namespace',
  'id_namespace is not null'
);

select col_hasnt_default(
  'public', 'library_entries', 'id_namespace',
  'id_namespace has no default'
);

select enum_has_labels(
  'public', 'media_id_namespace', array['mal'],
  'media_id_namespace holds the mal namespace only'
);

-- BR-06: a default false would fail open, so every write sets the adult flag from the snapshot
select col_not_null(
  'public', 'library_entries', 'media_is_adult',
  'media_is_adult is not null'
);

select col_hasnt_default(
  'public', 'library_entries', 'media_is_adult',
  'media_is_adult has no default'
);

-- setup as postgres: one backdated entry per user
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
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'mal', 'anime', 1, 'Cowboy Bebop', 'TV', 26, false, '2000-01-01', '2000-01-01'
  ),
  (
    '00000000-0000-0000-0000-00000000b001',
    '00000000-0000-0000-0000-000000000002',
    'mal', 'manga', 5, 'Monster', 'Manga', 162, false, '2000-01-01', '2000-01-01'
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
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values (
      'mal', 'anime', 2, 'Trigun', 'TV', false,
      'https://cdn.myanimelist.net/images/anime/7/20310.jpg'
    )
    returning user_id
  $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid) $$,
  'an entry inserted without user_id belongs to the signed-in user'
);

select results_eq(
  $$ select external_id from public.library_entries order by external_id $$,
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
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 2
    returning external_id
  $$,
  $$ values (2) $$,
  'the owner deletes their own entry'
);

-- server-controlled columns have no insert or update grant
select throws_ok(
  $$
    insert into public.library_entries (
      user_id, id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values (
      '00000000-0000-0000-0000-000000000001', 'mal', 'anime', 3, 'Akira', 'Movie', false
    )
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
    insert into public.library_entries (
      id, id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values (
      '00000000-0000-0000-0000-00000000a0ff', 'mal', 'anime', 4, 'Paprika', 'Movie', false
    )
  $$,
  '42501',
  null,
  'id cannot be chosen by the client'
);

-- BR-06: the adult flag has no default, an insert without it fails
select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format
    ) values ('mal', 'anime', 36, 'Nana', 'TV')
  $$,
  '23502',
  'null value in column "media_is_adult" of relation "library_entries" violates not-null constraint',
  'BR-06: an entry without media_is_adult is rejected'
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
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_total_units, progress
    ) values ('mal', 'anime', 20, 'Planetes', 'TV', false, 12, 13)
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
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult, score
    ) values
      ('mal', 'anime', 21, 'Mushishi', 'TV', false, 10),
      ('mal', 'anime', 22, 'Haibane Renmei', 'TV', false, null)
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

-- media identity
select throws_ok(
  $$
    insert into public.library_entries (
      media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('anime', 29, 'Haikyuu', 'TV', false)
  $$,
  '23502',
  null,
  'an entry without id_namespace is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('anilist', 'anime', 30, 'Mononoke', 'TV', false)
  $$,
  '22P02',
  null,
  'an unknown id namespace is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 0, 'Zero', 'TV', false)
  $$,
  '23514',
  'new row for relation "library_entries" violates check constraint "library_entries_external_id_check"',
  'an external_id of 0 is rejected by library_entries_external_id_check'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 2147483647, 'Max', 'TV', false)
  $$,
  'the largest integer external_id is accepted'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 2147483648, 'Overflow', 'TV', false)
  $$,
  '22003',
  null,
  'an external_id above the integer range is rejected'
);

-- media snapshot: rejected one past each limit, accepted exactly at it
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
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 23, '', 'TV', false)
  $$,
  '23514',
  null,
  'an empty media title is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values ('mal', 'anime', 25, repeat('a', 501), 'TV', false, null)
  $$,
  '23514',
  null,
  'a media title of 501 characters is rejected'
);

-- char_length counts code points: U+1F600 is one character of four bytes
select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 31, repeat(U&'\+01F600', 500), 'TV', false)
  $$,
  'a media title of 500 multi-byte characters is accepted'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 32, 'K', 'TV', false)
  $$,
  'a media title of 1 character is accepted'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values ('mal', 'anime', 26, 'Kino', '', false, null)
  $$,
  '23514',
  null,
  'an empty media format is rejected'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values ('mal', 'anime', 27, 'Kino', repeat('a', 33), false, null)
  $$,
  '23514',
  null,
  'a media format of 33 characters is rejected'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 33, 'Kino', repeat('a', 32), false)
  $$,
  'a media format of 32 characters is accepted'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 34, 'Kino', 'a', false)
  $$,
  'a media format of 1 character is accepted'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values ('mal', 'anime', 28, 'Kino', 'TV', false, 'https://' || repeat('a', 2041))
  $$,
  '23514',
  null,
  'an image url of 2049 characters is rejected'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_image_url
    ) values ('mal', 'anime', 35, 'Kino', 'TV', true, 'https://' || repeat('a', 2040))
  $$,
  'an image url of 2048 characters is accepted'
);

select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult,
      media_total_units
    ) values ('mal', 'anime', 24, 'Kaiba', 'TV', false, 0)
  $$,
  '23514',
  null,
  'a media total of 0 units is rejected'
);

-- one entry per user and media: (user_id, id_namespace, media_kind, external_id)
select throws_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 1, 'Cowboy Bebop', 'TV', false)
  $$,
  '23505',
  'duplicate key value violates unique constraint "library_entries_user_media_key"',
  'the same media cannot be added twice by the same user (library_entries_user_media_key)'
);

select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'manga', 1, 'Cowboy Bebop', 'Manga', false)
  $$,
  'the same external_id is accepted for the other media kind'
);

-- upsert as postgrest sends it: every payload column, the media identity included, is in the
-- do update set list, so a narrower update grant would break the repository and the guest merge
select lives_ok(
  $$
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult, progress
    ) values ('mal', 'anime', 1, 'Cowboy Bebop', 'TV', false, 7)
    on conflict (user_id, id_namespace, media_kind, external_id) do update
    set id_namespace = excluded.id_namespace,
      media_kind = excluded.media_kind,
      external_id = excluded.external_id,
      media_title = excluded.media_title,
      media_format = excluded.media_format,
      media_is_adult = excluded.media_is_adult,
      progress = excluded.progress
  $$,
  'the owner upserts an existing media'
);

select results_eq(
  $$
    select id, progress
    from public.library_entries
    where id_namespace = 'mal' and media_kind = 'anime' and external_id = 1
  $$,
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
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 1, 'Cowboy Bebop', 'TV', false)
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
    insert into public.library_entries (
      id_namespace, media_kind, external_id, media_title, media_format, media_is_adult
    ) values ('mal', 'anime', 3, 'Akira', 'Movie', false)
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
