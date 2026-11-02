-- the replay of the account library writes the server has not confirmed (A-05, ADR-0017): a save
-- or a removal queued on the device is sent later with the time of its change, so the most recent
-- change wins across devices (BR-08) whatever the order the devices reach the server. a
-- client-supplied time is honored only by the guest merge and by this replay, capped at the
-- server's now(); every regular write keeps the server time, and authenticated still has no
-- privilege on updated_at. public.merge_guest_library_entries and
-- private.write_client_library_entry are unchanged

-- ---------------------------------------------------------------------------
-- the removal of an entry carrying the time of its removal (BR-08)
-- ---------------------------------------------------------------------------

-- the timestamp rule of a client removal that carries the time of its change, the counterpart of
-- private.write_client_library_entry for a removal (no tombstone: the absence has no stored time).
-- `entry` is a json object of the media key columns and updated_at (the time of the removal), its
-- shape validated by the caller; any other key is ignored. the user is auth.uid(), never an input
-- (42501 without one). updated_at must be a string of the form client_time_pattern, checked
-- before any cast, then a finite time no earlier than earliest_time, and the key complete, else
-- 22023 with a fixed message holding no value. the stored entry of the caller and the key is
-- deleted only when its updated_at is strictly earlier than that time capped at the now() of the
-- calling transaction: an equal or newer stored entry is kept. true when the row was deleted or
-- the caller has no row of the key (the absence asked for holds), false when a row as recent or
-- newer is kept. called under definer rights, which bypass rls, it filters on auth.uid() itself
create function private.remove_client_library_entry(entry jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- the rfc 3339 form of a client time: the same pattern as in private.write_client_library_entry
  client_time_pattern constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  -- the earliest time the client reads back: the same bound as in
  -- private.write_client_library_entry
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
  -- a key with a null column matches no row: refused rather than answered as an absence
  if input.id_namespace is null or input.media_kind is null or input.external_id is null then
    raise exception 'the media key must be complete' using errcode = '22023';
  end if;
  delete from public.library_entries as stored
  where stored.user_id = caller
    and stored.id_namespace = input.id_namespace
    and stored.media_kind = input.media_kind
    and stored.external_id = input.external_id
    and stored.updated_at < least(input.updated_at, pg_catalog.now());
  if found then
    return true;
  end if;
  -- nothing deleted: the absence holds unless a row of the caller and the key was kept
  return not exists (
    select 1
    from public.library_entries as stored
    where stored.user_id = caller
      and stored.id_namespace = input.id_namespace
      and stored.media_kind = input.media_kind
      and stored.external_id = input.external_id
  );
end;
$$;

revoke execute on function private.remove_client_library_entry(jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- the replay of queued writes (BR-08, FR-23, ADR-0017): exposed to authenticated only
-- ---------------------------------------------------------------------------

-- replays queued writes of the caller, each in input order through
-- private.write_client_library_entry (a save) or private.remove_client_library_entry (a removal),
-- in the request's single transaction: a call is applied whole or not at all (a validation,
-- constraint or cast error rejects it). one row per write, in input order: its key, the caller's
-- user id and `written` or `kept`.
--
-- security definer, owned by postgres: the replay writes updated_at, which no client role may.
-- definer rights bypass rls, so the user is only ever auth.uid() (42501 without one), never an
-- input. expected_user_id is a guard, never a source: 42501 when auth.uid() is distinct from it,
-- so the writes queued for one user never land in another account when the token changed after
-- the client's session guard. an element is an object of `op` and exactly the columns of its
-- op, never user_id, id or created_at, and every write holds auth.uid(), so a call reaches the
-- caller's own rows only. the input is bounded (max_writes) and validated whole before any
-- write, updated_at a string of the rfc 3339 form before any cast, each failure raising 22023
-- with a fixed message holding no value
create function public.replay_library_writes(expected_user_id uuid, writes jsonb)
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
  -- the writes of one call at most: LIBRARY_REPLAY_BATCH_SIZE (src/core/domain/library-sync.ts),
  -- the batch the client sends, must stay equal to it
  max_writes constant integer := 100;
  -- the keys of a save, exactly: op, the writable columns of library_entries and updated_at
  save_keys constant text[] := array[
    'op',
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
  -- the keys of a removal, exactly: op, the media key and updated_at (the time of the removal)
  remove_keys constant text[] := array[
    'op',
    'id_namespace',
    'media_kind',
    'external_id',
    'updated_at'
  ];
  -- the rfc 3339 form of a client time: the same pattern as in private.write_client_library_entry
  client_time_pattern constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
  -- the earliest time the client reads back: the same bound as in
  -- private.write_client_library_entry
  earliest_time constant timestamptz := '0001-01-01 00:00:00+00';
  caller uuid := auth.uid();
  queued jsonb;
  input public.library_entries;
  applied boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if caller is distinct from expected_user_id then
    raise exception 'not the expected user' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(writes) is distinct from 'array' then
    raise exception 'writes must be a json array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(writes) > max_writes then
    raise exception 'too many writes' using errcode = '22023';
  end if;
  -- one check per statement: sql does not fix the evaluation order of a condition, and
  -- jsonb_object_keys raises on a value that is not an object
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    where pg_catalog.jsonb_typeof(element.value) <> 'object'
  ) then
    raise exception 'a write is not a json object' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    where pg_catalog.jsonb_typeof(element.value -> 'op') is distinct from 'string'
      or (element.value ->> 'op') not in ('save', 'remove')
  ) then
    raise exception 'a write has no known op' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    cross join lateral (
      select case element.value ->> 'op' when 'save' then save_keys else remove_keys end
    ) as expected (key_names)
    where not element.value ?& expected.key_names
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(element.value))
        <> pg_catalog.cardinality(expected.key_names)
  ) then
    raise exception 'a write does not hold exactly the expected keys' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    where pg_catalog.jsonb_typeof(element.value -> 'updated_at') <> 'string'
  ) then
    raise exception 'a write has no updated_at string' using errcode = '22023';
  end if;
  -- the form of every time before any cast: the checks below cast it
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    where (element.value ->> 'updated_at') !~ client_time_pattern
  ) then
    raise exception 'a write has no rfc 3339 updated_at' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(writes) as element (value)
    where (element.value ->> 'updated_at')::timestamptz < earliest_time
  ) then
    raise exception 'a write has an updated_at before the year 1' using errcode = '22023';
  end if;
  -- the keys as the table types them, so two spellings of one key count as one; `op` is not a
  -- column and is ignored here
  if exists (
    select 1
    from pg_catalog.jsonb_populate_recordset(null::public.library_entries, writes) as typed
    group by typed.id_namespace, typed.media_kind, typed.external_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'writes hold a key twice' using errcode = '22023';
  end if;
  for queued in
    select element.value
    from pg_catalog.jsonb_array_elements(writes) with ordinality as element (value, ordinal)
    order by element.ordinal
  loop
    input := pg_catalog.jsonb_populate_record(null::public.library_entries, queued);
    if queued ->> 'op' = 'save' then
      applied := private.write_client_library_entry(queued - 'op');
    else
      applied := private.remove_client_library_entry(queued - 'op');
    end if;
    id_namespace := input.id_namespace;
    media_kind := input.media_kind;
    external_id := input.external_id;
    user_id := caller;
    outcome := case when applied then 'written' else 'kept' end;
    return next;
  end loop;
end;
$$;

-- new functions are executable by public by default, and supabase's default privileges may grant
-- them to anon and authenticated: revoked explicitly, then granted to authenticated only
revoke execute on function public.replay_library_writes(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replay_library_writes(uuid, jsonb) to authenticated;
