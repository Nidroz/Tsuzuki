-- the input of the two api functions bounded by size as well as by count (R-04): the guest merge
-- (public.merge_guest_library_entries, ADR-0016) and the replay of queued writes
-- (public.replay_library_writes, ADR-0017) refuse an input whose jsonb text is longer than the
-- largest valid batch, before any per-element check or cast, with 22023 and a fixed message
-- holding no value. postgrest has already parsed the request body into jsonb when a function
-- runs: the bound limits the validation, the casts and the writes of a call, not the parse.
-- both functions are replaced with the same signature, owner, security mode and search_path, and
-- their privileges are stated again; nothing else of them changes
--
-- the bound of a call is octet_length(<input>::text) <= max_count * (element + 2): at most
-- max_count elements, each at most the bytes below, and 2 bytes of array punctuation per element
-- ("[" and "]" for the first, ", " before each other one). jsonb text is canonical (no whitespace
-- but ", " and ": ", one spelling per value), so the bound depends on the values only, never on
-- how the client formatted its body. one element at its worst case: every column at the largest
-- value the table's constraints accept, each code point of a string at its largest form in jsonb
-- text (a control character is the 6 bytes \uXXXX, a quote or a backslash 2, any other code point
-- at most 4 utf-8 bytes), char limits counted in code points, as char_length does:
--
--   value                                                       | bytes
--   ------------------------------------------------------------+-------
--   media_title: 500 code points x 6, 2 quotes                  |  3002
--   media_image_url: 2048 code points x 6, 2 quotes             | 12290
--   media_format: 32 code points x 6, 2 quotes                  |   194
--   notes: 2000 code points x 6, 2 quotes                       | 12002
--   id_namespace, media_kind, status: an enum label, at most    |
--     63 bytes (NAMEDATALEN - 1) so a later label fits, quotes  |   195 (3 x 65)
--   external_id, media_total_units, progress: 2147483647        |    30 (3 x 10)
--   score: null (4 bytes, 10 is 2)                              |     4
--   media_is_adult, is_favorite: false                          |    10 (2 x 5)
--   started_at, finished_at: "YYYY-MM-DD", the client's form    |    24 (2 x 12)
--     (calendarDateSchema)                                      |
--   updated_at: "YYYY-MM-DDTHH:MM:SS.ffffff+HH:MM", the longest |    34
--     form of client_time_pattern                               |
--   16 keys: their 168 characters, 2 quotes and ": " each       |   232
--   15 ", " between the pairs, 2 braces                         |    32
--   ------------------------------------------------------------+-------
--   a guest entry (merge)                                       | 28049
--   a queued save (replay): plus "op": "save" and one ", "      | 28063
--   (a queued removal holds 5 of these keys: smaller)           |
--
-- so a merge call is at most 100 * (28049 + 2) = 2805100 bytes and a replay call at most
-- 100 * (28063 + 2) = 2806500 bytes. a valid client batch is never refused: the client validates
-- every element against the column limits first (libraryEntrySchema, libraryQueuedWriteSchema)
-- and sends at most 100 of them (GUEST_MERGE_BATCH_SIZE, LIBRARY_REPLAY_BATCH_SIZE). a maximal
-- valid element, the longest labels of today's enums and an image url starting with https://,
-- is 27837 bytes (merge) and 27851 (replay save)

-- ---------------------------------------------------------------------------
-- the guest merge (BR-08, FR-22, ADR-0016)
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
-- caller's own rows only. the input is bounded by count (max_entries) and by size
-- (max_input_bytes) and its shape validated before any write, updated_at a string of the rfc 3339
-- form before any cast, each failure raising 22023 with a fixed message holding no value
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
  -- the jsonb text of one entry at most: the table at the top of this migration
  max_entry_bytes constant integer := 28049;
  -- the array punctuation of one element: "[" and "]" for the first, ", " before each other one
  element_punctuation_bytes constant integer := 2;
  -- the jsonb text of one call at most: 2805100 bytes
  max_input_bytes constant integer :=
    max_entries * (max_entry_bytes + element_punctuation_bytes);
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
  -- the size of the whole input, before any per-element check or cast
  if pg_catalog.octet_length(entries::text) > max_input_bytes then
    raise exception 'entries are too large' using errcode = '22023';
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

-- ---------------------------------------------------------------------------
-- the replay of queued writes (BR-08, FR-23, ADR-0017)
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
-- caller's own rows only. the input is bounded by count (max_writes) and by size
-- (max_input_bytes) and validated whole before any write, updated_at a string of the rfc 3339
-- form before any cast, each failure raising 22023 with a fixed message holding no value
create or replace function public.replay_library_writes(expected_user_id uuid, writes jsonb)
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
  -- the jsonb text of one write at most, a save: the table at the top of this migration
  max_write_bytes constant integer := 28063;
  -- the array punctuation of one element: "[" and "]" for the first, ", " before each other one
  element_punctuation_bytes constant integer := 2;
  -- the jsonb text of one call at most: 2806500 bytes
  max_input_bytes constant integer :=
    max_writes * (max_write_bytes + element_punctuation_bytes);
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
  -- the size of the whole input, before any per-element check or cast
  if pg_catalog.octet_length(writes::text) > max_input_bytes then
    raise exception 'writes are too large' using errcode = '22023';
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
