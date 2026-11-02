-- input of the replay of queued library writes (ADR-0017): public.replay_library_writes takes a
-- json array of at most 100 objects, each a save of exactly the writable columns and updated_at
-- or a removal of exactly the media key and updated_at, updated_at in the rfc 3339 form only and
-- no earlier than the year 1, each key once. every refusal is 22023 with a fixed message, and a
-- refused call writes nothing of its batch, a removal included. the removal helper checks its
-- input itself for its other callers
begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

-- a queued save as the client sends it: op, every writable column and the time of the change
create function pg_temp.save_write(
  external_id integer,
  updated_at text,
  progress integer default 0
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'op', 'save',
    'id_namespace', 'mal',
    'media_kind', 'anime',
    'external_id', external_id,
    'media_title', 'Queued title',
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

-- the valid writes every refused batch below starts with: a save of a new key (31) and the
-- removal of an older stored row (10), neither of which may be applied
create function pg_temp.valid_writes()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    pg_temp.save_write(31, '2026-01-15T08:00:00.000Z'),
    pg_temp.remove_write(10, '2026-02-01T08:00:00.000Z')
  )
$$;

-- setup as postgres: one entry of the owner, older than the removal of valid_writes
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test');

insert into public.library_entries (
  id, user_id, id_namespace, media_kind, external_id, media_title, media_format,
  media_is_adult, progress, created_at, updated_at
) values (
  '00000000-0000-0000-0000-00000000a010', '00000000-0000-0000-0000-000000000001',
  'mal', 'anime', 10, 'Serial Experiments Lain', 'tv', false, 4,
  '2026-01-01 00:00:00+00', '2026-01-10 12:00:00+00'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- the array and its length

select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001', pg_temp.save_write(31, '2026-01-15T08:00:00.000Z')
    )
  $$,
  '22023',
  'writes must be a json array',
  'writes that are not an array are rejected'
);

select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      (
        select jsonb_agg(pg_temp.save_write(2000 + item, '2026-01-15T08:00:00.000Z'))
        from generate_series(1, 101) as item
      )
    )
  $$,
  '22023',
  'too many writes',
  'a batch of 101 writes is rejected'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      (
        select jsonb_agg(pg_temp.save_write(1000 + item, '2026-01-15T08:00:00.000Z'))
        from generate_series(1, 100) as item
      )
    )
  ),
  100,
  'a batch of 100 writes is replayed'
);

-- each refused write after the valid ones: the message of the first check it fails
select throws_ok(
  format(
    $$
      select * from public.replay_library_writes(
        '00000000-0000-0000-0000-000000000001', pg_temp.valid_writes() || %L::jsonb
      )
    $$,
    probe.writes
  ),
  '22023',
  probe.message,
  format('a batch with %s is rejected', probe.label)
)
from (
  values
    ('a number', '[1]'::jsonb, 'a write is not a json object'),
    ('an array', '[[]]'::jsonb, 'a write is not a json object'),
    (
      'an unknown op',
      jsonb_build_array(pg_temp.save_write(50, '2026-01-15T08:00:00.000Z') || '{"op": "upsert"}'),
      'a write has no known op'
    ),
    (
      'no op',
      jsonb_build_array(pg_temp.save_write(50, '2026-01-15T08:00:00.000Z') - 'op'),
      'a write has no known op'
    ),
    (
      'an op that is not a string',
      jsonb_build_array(pg_temp.save_write(50, '2026-01-15T08:00:00.000Z') || '{"op": 1}'),
      'a write has no known op'
    ),
    (
      'a save naming a user',
      jsonb_build_array(
        pg_temp.save_write(50, '2026-01-15T08:00:00.000Z')
          || '{"user_id": "00000000-0000-0000-0000-000000000001"}'
      ),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a save naming created_at',
      jsonb_build_array(
        pg_temp.save_write(50, '2026-01-15T08:00:00.000Z')
          || '{"created_at": "2026-01-01T00:00:00.000Z"}'
      ),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a save missing a column',
      jsonb_build_array(pg_temp.save_write(50, '2026-01-15T08:00:00.000Z') - 'notes'),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a save missing updated_at',
      jsonb_build_array(pg_temp.save_write(50, '2026-01-15T08:00:00.000Z') - 'updated_at'),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a removal naming a user',
      jsonb_build_array(
        pg_temp.remove_write(50, '2026-01-15T08:00:00.000Z')
          || '{"user_id": "00000000-0000-0000-0000-000000000001"}'
      ),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a removal naming created_at',
      jsonb_build_array(
        pg_temp.remove_write(50, '2026-01-15T08:00:00.000Z')
          || '{"created_at": "2026-01-01T00:00:00.000Z"}'
      ),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a removal holding a save column',
      jsonb_build_array(
        pg_temp.remove_write(50, '2026-01-15T08:00:00.000Z') || '{"media_title": "Queued title"}'
      ),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a removal missing updated_at',
      jsonb_build_array(pg_temp.remove_write(50, '2026-01-15T08:00:00.000Z') - 'updated_at'),
      'a write does not hold exactly the expected keys'
    ),
    (
      'a save with a null updated_at',
      jsonb_build_array(pg_temp.save_write(50, null)),
      'a write has no updated_at string'
    ),
    (
      'a removal with a null updated_at',
      jsonb_build_array(pg_temp.remove_write(50, null)),
      'a write has no updated_at string'
    ),
    (
      'a removal with a numeric updated_at',
      jsonb_build_array(pg_temp.remove_write(50, null) || '{"updated_at": 1767225600}'),
      'a write has no updated_at string'
    ),
    (
      'a key saved and removed',
      jsonb_build_array(
        pg_temp.save_write(60, '2026-01-15T08:00:00.000Z'),
        pg_temp.remove_write(60, '2026-01-16T08:00:00.000Z')
      ),
      'writes hold a key twice'
    ),
    (
      'a key saved twice',
      jsonb_build_array(
        pg_temp.save_write(60, '2026-01-15T08:00:00.000Z'),
        pg_temp.save_write(60, '2026-01-16T08:00:00.000Z')
      ),
      'writes hold a key twice'
    ),
    (
      'a key spelled as a number and as a string',
      jsonb_build_array(
        pg_temp.save_write(60, '2026-01-15T08:00:00.000Z'),
        pg_temp.remove_write(60, '2026-01-16T08:00:00.000Z') || '{"external_id": "60"}'
      ),
      'writes hold a key twice'
    ),
    (
      'a removal without an external_id',
      jsonb_build_array(
        pg_temp.remove_write(70, '2026-01-15T08:00:00.000Z') || '{"external_id": null}'
      ),
      'the media key must be complete'
    ),
    (
      'a removal without a media_kind',
      jsonb_build_array(
        pg_temp.remove_write(70, '2026-01-15T08:00:00.000Z') || '{"media_kind": null}'
      ),
      'the media key must be complete'
    )
) as probe (label, writes, message);

-- updated_at in the rfc 3339 form only, checked before any cast: strings postgres would read as
-- a time are refused, on a save and on a removal
select throws_ok(
  format(
    $$
      select * from public.replay_library_writes(
        '00000000-0000-0000-0000-000000000001',
        pg_temp.valid_writes() || jsonb_build_array(%s)
      )
    $$,
    probe.write
  ),
  '22023',
  'a write has no rfc 3339 updated_at',
  format('an updated_at of %s is rejected', probe.label)
)
from (
  values
    ('epoch', $q$pg_temp.remove_write(80, 'epoch')$q$),
    ('now', $q$pg_temp.save_write(80, 'now')$q$),
    ('infinity', $q$pg_temp.remove_write(80, 'infinity')$q$),
    ('-infinity', $q$pg_temp.save_write(80, '-infinity')$q$),
    ('a BC date', $q$pg_temp.remove_write(80, '0044-03-15 00:00:00+00 BC')$q$),
    ('a time without the T', $q$pg_temp.save_write(80, '2026-01-15 08:00:00+00')$q$)
) as probe (label, write);

-- a valid form whose offset reaches before the year 1 in utc is refused after the cast
select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      pg_temp.valid_writes()
        || jsonb_build_array(pg_temp.remove_write(81, '0001-01-01T00:00:00+01:00'))
    )
  $$,
  '22023',
  'a write has an updated_at before the year 1',
  'a removal time before the year 1 in utc is rejected'
);

select results_eq(
  $$
    select outcome
    from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(pg_temp.remove_write(82, '0001-01-01T00:00:00.000Z'))
    )
  $$,
  $$ values ('written') $$,
  'a removal at the first instant of the year 1 is replayed'
);

-- a write outside the table constraints rejects the call: the removal before it is rolled back
select throws_ok(
  $$
    select * from public.replay_library_writes(
      '00000000-0000-0000-0000-000000000001',
      pg_temp.valid_writes()
        || jsonb_build_array(pg_temp.save_write(83, '2026-01-15T08:00:00.000Z', -1))
    )
  $$,
  '23514',
  null,
  'a batch with a write outside the constraints is rejected'
);

-- verification as postgres
reset role;

select results_eq(
  $$
    select progress, updated_at
    from public.library_entries
    where id = '00000000-0000-0000-0000-00000000a010'
  $$,
  $$ values (4, '2026-01-10 12:00:00+00'::timestamptz) $$,
  'a rejected batch deletes nothing'
);

select is_empty(
  $$
    select external_id
    from public.library_entries
    where external_id between 30 and 99 or external_id > 2000
  $$,
  'a rejected batch writes none of its saves'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.library_entries
    where user_id = '00000000-0000-0000-0000-000000000001' and external_id between 1001 and 1100
  ),
  100,
  'the batch of 100 writes is stored for the owner'
);

-- the removal helper checks the form and the key itself, for its other callers: a time postgres
-- would read, a null one and an incomplete key are refused, and it needs a user
select throws_ok(
  format(
    $$ select private.remove_client_library_entry(%L::jsonb) $$,
    probe.entry
  ),
  '22023',
  probe.message,
  format('the removal helper refuses %s', probe.label)
)
from (
  values
    (
      'an updated_at of epoch',
      pg_temp.remove_write(10, 'epoch') - 'op',
      'updated_at must be an rfc 3339 timestamp'
    ),
    (
      'a null updated_at',
      pg_temp.remove_write(10, null) - 'op',
      'updated_at must be an rfc 3339 timestamp'
    ),
    (
      'an incomplete key',
      (pg_temp.remove_write(10, '2026-02-01T08:00:00.000Z') - 'op') || '{"external_id": null}',
      'the media key must be complete'
    )
) as probe (label, entry, message);

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select throws_ok(
  $$
    select private.remove_client_library_entry(
      pg_temp.remove_write(10, '2026-02-01T08:00:00.000Z') - 'op'
    )
  $$,
  '42501',
  'not authenticated',
  'the removal helper needs a user'
);

select * from finish();

rollback;
