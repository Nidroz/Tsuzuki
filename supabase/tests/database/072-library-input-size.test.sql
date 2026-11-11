-- size of the input of the two api functions (R-04): public.merge_guest_library_entries and
-- public.replay_library_writes refuse an input whose jsonb text is longer than 100 elements of the
-- worst case the column limits allow (the table of *_library_input_byte_bounds.sql) plus their
-- array punctuation, before any per-element check, with 22023 and a fixed message; a refused call
-- writes nothing. a full batch of maximal valid elements, every column at its limit and every
-- string of control characters (6 bytes each in jsonb text), is accepted whole
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- the bounds of the migration: 100 elements of at most 28049 (an entry) or 28063 (a queued save)
-- bytes, and 2 bytes of array punctuation each
create function pg_temp.merge_bound()
returns integer
language sql
as $$ select 100 * (28049 + 2) $$;

create function pg_temp.replay_bound()
returns integer
language sql
as $$ select 100 * (28063 + 2) $$;

-- a guest entry at the limit of every column: control characters in every string, the largest
-- integers, the longest labels of the enums and the longest form of updated_at
create function pg_temp.max_entry(external_id integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id_namespace', 'mal',
    'media_kind', 'manga',
    'external_id', external_id,
    'media_title', repeat(chr(1), 500),
    'media_image_url', 'https://' || repeat(chr(1), 2040),
    'media_format', repeat(chr(1), 32),
    'media_total_units', 2147483647,
    'media_is_adult', false,
    'status', 'completed',
    'progress', 2147483647,
    'score', null,
    'notes', repeat(chr(1), 2000),
    'is_favorite', false,
    'started_at', '9999-12-31',
    'finished_at', '9999-12-31',
    'updated_at', '2026-01-15T08:00:00.123456+14:00'
  )
$$;

-- an input of exactly `bytes` bytes of jsonb text: `prefix`, then one object of a padded string
create function pg_temp.sized_input(bytes integer, prefix jsonb default '[]')
returns jsonb
language sql
as $$
  select prefix || jsonb_build_array(jsonb_build_object(
    'notes',
    repeat(
      'x',
      bytes - octet_length((prefix || jsonb_build_array(jsonb_build_object('notes', '')))::text)
    )
  ))
$$;

-- setup as postgres
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- the guest merge

select is(
  octet_length(pg_temp.max_entry(2147483647)::text),
  27837,
  'a maximal valid guest entry is 27837 bytes of jsonb text, within the 28049 of the bound'
);

select results_eq(
  $$
    select outcome, pg_catalog.count(*)::integer
    from public.merge_guest_library_entries(
      (
        select jsonb_agg(pg_temp.max_entry(2147483647 - item))
        from generate_series(0, 99) as item
      )
    )
    group by outcome
  $$,
  $$ values ('written', 100) $$,
  'a batch of 100 maximal valid entries is merged whole'
);

select throws_ok(
  $$ select * from public.merge_guest_library_entries(pg_temp.sized_input(pg_temp.merge_bound())) $$,
  '22023',
  'an entry does not hold exactly the expected keys',
  'an input of exactly the bound passes the size check, to the next check'
);

select throws_ok(
  $$
    select * from public.merge_guest_library_entries(
      pg_temp.sized_input(pg_temp.merge_bound() + 1, jsonb_build_array(pg_temp.max_entry(10)))
    )
  $$,
  '22023',
  'entries are too large',
  'an input one byte over the bound is refused before any per-element check'
);

-- the queued saves of the replay: a maximal entry and its op

select is(
  octet_length((pg_temp.max_entry(2147483647) || '{"op": "save"}')::text),
  27851,
  'a maximal valid queued save is 27851 bytes of jsonb text, within the 28063 of the bound'
);

select results_eq(
  $$
    select outcome, pg_catalog.count(*)::integer
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      (
        select jsonb_agg(pg_temp.max_entry(2147483547 - item) || '{"op": "save"}')
        from generate_series(0, 99) as item
      )
    )
    group by outcome
  $$,
  $$ values ('written', 100) $$,
  'a batch of 100 maximal valid saves is replayed whole'
);

select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001', pg_temp.sized_input(pg_temp.replay_bound())
    )
  $$,
  '22023',
  'a write has no known op',
  'an input of exactly the bound passes the size check, to the next check'
);

select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      pg_temp.sized_input(
        pg_temp.replay_bound() + 1, jsonb_build_array(pg_temp.max_entry(20) || '{"op": "save"}')
      )
    )
  $$,
  '22023',
  'writes are too large',
  'an input one byte over the bound is refused before any per-element check'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select media_title = repeat(chr(1), 500), notes = repeat(chr(1), 2000),
      char_length(media_image_url), pg_catalog.count(*)::integer
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001'
      and external_id between 2147483648 - 100 and 2147483647
    group by 1, 2, 3
  $$,
  $$ values (true, true, 2048, 100) $$,
  'the merged batch is stored whole, every string at its limit'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001'
      and external_id between 2147483548 - 100 and 2147483547
  ),
  100,
  'the replayed batch is stored whole'
);

select is_empty(
  $$
    select external_id
    from public.library_entries
    where external_id in (10, 20)
  $$,
  'an input over the bound writes none of its valid elements'
);

select is(
  (select pg_catalog.count(*)::integer from public.library_entries),
  200,
  'nothing but the two accepted batches is stored'
);

select * from finish();

rollback;
