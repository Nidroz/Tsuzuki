-- the client time of the guest merge (BR-08, ADR-0016) in one form only: the updated_at of an
-- entry must be a string in the rfc 3339 form the client sends, checked before any cast. postgres
-- reads many other strings as a timestamptz ('epoch', 'now', 'yesterday', a BC date, a
-- DateStyle-dependent '1/2/2026'), and a BC time is served back in a form the client rejects
-- (timestampSchema), so its row could no longer be read. the cast time must also be finite and
-- no earlier than the year 1 in utc, which a valid form with an offset can still reach. both
-- functions of 20261101182502_guest_merge_client_time.sql are replaced with the same signature,
-- security mode and search_path, and their privileges are stated again

-- ---------------------------------------------------------------------------
-- the write of an entry carrying its own modification time (BR-08)
-- ---------------------------------------------------------------------------

-- the timestamp rule of a client write that carries the time of its change: the guest merge
-- (public.merge_guest_library_entries) now, the replay of offline writes (A-05) later. `entry` is
-- a json object of the writable columns and updated_at, its shape validated by the caller; any
-- other key is ignored. the user is auth.uid(), never an input (42501 without one). updated_at
-- must be a string of the form client_time_pattern, checked before any cast, then a finite time
-- no earlier than earliest_time, else 22023 with a fixed message holding no value. the time is
-- that updated_at capped at the now() of the calling transaction: a device clock ahead of the
-- server cannot win over a change made after that call, but a later call caps at its own now()
-- (see the merge's retry, src/core/repositories/library-repository.ts). the entry is inserted
-- when the user has no entry of its key, and replaces the stored values and time only when
-- strictly newer: an equal or newer stored copy is kept (BR-08). true when written, false when
-- kept. it writes user_id and updated_at, which no api role may, so it runs under a security
-- definer caller only
create or replace function private.write_client_library_entry(entry jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- the rfc 3339 form of a client time, Date#toISOString output among others: an uppercase T, no
  -- fraction or 1 to 6 digits, an offset Z or ±HH:MM. the same pattern as in
  -- public.merge_guest_library_entries
  client_time_pattern constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  -- the earliest time the client reads back: timestampSchema has no year before 1, and postgres
  -- serves an earlier time with a BC suffix
  earliest_time constant timestamptz := '0001-01-01 00:00:00+00';
  caller uuid := auth.uid();
  input public.library_entries;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- null when updated_at is missing, json null or entry is not an object: refused as well
  if not coalesce((entry ->> 'updated_at') ~ client_time_pattern, false) then
    raise exception 'updated_at must be an rfc 3339 timestamp' using errcode = '22023';
  end if;
  input := pg_catalog.jsonb_populate_record(null::public.library_entries, entry);
  -- a second guard: the form above admits no null or infinite time
  if input.updated_at is null or not pg_catalog.isfinite(input.updated_at) then
    raise exception 'updated_at must be a finite timestamp' using errcode = '22023';
  end if;
  if input.updated_at < earliest_time then
    raise exception 'updated_at must not be before the year 1' using errcode = '22023';
  end if;
  insert into public.library_entries as stored (
    user_id,
    id_namespace,
    media_kind,
    external_id,
    media_title,
    media_image_url,
    media_format,
    media_total_units,
    media_is_adult,
    status,
    progress,
    score,
    notes,
    is_favorite,
    started_at,
    finished_at,
    updated_at
  ) values (
    caller,
    input.id_namespace,
    input.media_kind,
    input.external_id,
    input.media_title,
    input.media_image_url,
    input.media_format,
    input.media_total_units,
    input.media_is_adult,
    input.status,
    input.progress,
    input.score,
    input.notes,
    input.is_favorite,
    input.started_at,
    input.finished_at,
    least(input.updated_at, pg_catalog.now())
  )
  -- the key always holds the caller: another user's row is never a conflict, so never updated.
  -- excluded.updated_at is the capped time. the key columns are never updated
  on conflict (user_id, id_namespace, media_kind, external_id) do update
  set media_title = excluded.media_title,
    media_image_url = excluded.media_image_url,
    media_format = excluded.media_format,
    media_total_units = excluded.media_total_units,
    media_is_adult = excluded.media_is_adult,
    status = excluded.status,
    progress = excluded.progress,
    score = excluded.score,
    notes = excluded.notes,
    is_favorite = excluded.is_favorite,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    updated_at = excluded.updated_at
  where stored.updated_at < excluded.updated_at;
  return found;
end;
$$;

revoke execute on function private.write_client_library_entry(jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- the guest merge (BR-08, FR-22, ADR-0016): the only function the api may call
-- ---------------------------------------------------------------------------

-- merges guest entries into the caller's library, each through private.write_client_library_entry,
-- in the request's single transaction: a batch is written whole or not at all (a validation,
-- constraint or cast error rejects the call). one row per entry, in input order: its key, the
-- caller's user id and `written` or `kept`.
--
-- security definer, owned by postgres: the merge writes updated_at, which no client role may.
-- definer rights bypass rls, so the user is only ever auth.uid() (42501 without one), never an
-- input: an element is an object of exactly the writable columns and updated_at, never user_id,
-- id or created_at, and every write and its conflict key hold auth.uid(), so a call reaches the
-- caller's own rows only. the input is bounded (max_entries) and its shape validated before any
-- write, updated_at a string of the rfc 3339 form before any cast, each failure raising 22023
-- with a fixed message holding no value
create or replace function public.merge_guest_library_entries(entries jsonb)
returns table (
  id_namespace public.media_id_namespace,
  media_kind public.media_kind,
  external_id integer,
  user_id uuid,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- the entries of one call at most: the client sends batches of GUEST_MERGE_BATCH_SIZE
  -- (src/core/repositories/supabase/library-merge.ts), which must not exceed it
  max_entries constant integer := 100;
  -- the keys of every element, exactly: the writable columns of library_entries and updated_at
  entry_keys constant text[] := array[
    'id_namespace',
    'media_kind',
    'external_id',
    'media_title',
    'media_image_url',
    'media_format',
    'media_total_units',
    'media_is_adult',
    'status',
    'progress',
    'score',
    'notes',
    'is_favorite',
    'started_at',
    'finished_at',
    'updated_at'
  ];
  -- the rfc 3339 form of a client time: the same pattern as in private.write_client_library_entry
  client_time_pattern constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  caller uuid := auth.uid();
  entry jsonb;
  input public.library_entries;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(entries) is distinct from 'array' then
    raise exception 'entries must be a json array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(entries) > max_entries then
    raise exception 'too many entries' using errcode = '22023';
  end if;
  -- one check per statement: sql does not fix the evaluation order of a condition, and
  -- jsonb_object_keys raises on a value that is not an object
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(entries) as element (value)
    where pg_catalog.jsonb_typeof(element.value) <> 'object'
  ) then
    raise exception 'an entry is not a json object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(entries) as element (value)
    where not element.value ?& entry_keys
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(element.value))
        <> pg_catalog.cardinality(entry_keys)
  ) then
    raise exception 'an entry does not hold exactly the expected keys' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(entries) as element (value)
    where pg_catalog.jsonb_typeof(element.value -> 'updated_at') <> 'string'
  ) then
    raise exception 'an entry has no updated_at string' using errcode = '22023';
  end if;
  -- the form of every time before the cast of the key check below, which casts every column
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(entries) as element (value)
    where (element.value ->> 'updated_at') !~ client_time_pattern
  ) then
    raise exception 'an entry has no rfc 3339 updated_at' using errcode = '22023';
  end if;
  -- the keys as the table types them, so two spellings of one key count as one
  if exists (
    select 1
    from pg_catalog.jsonb_populate_recordset(null::public.library_entries, entries) as typed
    group by typed.id_namespace, typed.media_kind, typed.external_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'entries hold a key twice' using errcode = '22023';
  end if;
  for entry in
    select element.value
    from pg_catalog.jsonb_array_elements(entries) with ordinality as element (value, ordinal)
    order by element.ordinal
  loop
    input := pg_catalog.jsonb_populate_record(null::public.library_entries, entry);
    id_namespace := input.id_namespace;
    media_kind := input.media_kind;
    external_id := input.external_id;
    user_id := caller;
    outcome := case when private.write_client_library_entry(entry) then 'written' else 'kept' end;
    return next;
  end loop;
end;
$$;

-- new functions are executable by public by default, and supabase's default privileges may grant
-- them to anon and authenticated: revoked explicitly, then granted to authenticated only
revoke execute on function public.merge_guest_library_entries(jsonb)
  from public, anon, authenticated;
grant execute on function public.merge_guest_library_entries(jsonb) to authenticated;
