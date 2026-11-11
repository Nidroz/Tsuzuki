-- per-user caps on the library tables (R-04): an authenticated user could insert library entries
-- without bound, and grow progress_events without bound by changing a progress back and forth.
-- library_entries holds at most max_entries_per_user rows per user: an insert of a new key past
-- it is refused with sqlstate TZ001 and a fixed message holding no value, which postgrest answers
-- with 400 (an unlisted sqlstate, never a 5xx the client would retry as transient) and the client
-- maps to `library-full`. progress_events keeps the max_events_per_user most recent rows per user:
-- each insert deletes that user's older rows and never fails for the cap, so a progress change
-- never does. rows a user held over a cap before this migration stay: the entries until the user
-- removes some, the events until the next one is logged
--
-- the per-user lock: both triggers take pg_advisory_xact_lock(library_lock_namespace,
-- hashtext(user_id::text)) before they count, so the writes of one user that count serialize and
-- each count is exact: under read committed (postgrest's and these functions'), each query of a
-- volatile function takes a new snapshot, so a count after the lock sees the rows of the
-- transaction it waited for. another user waits only on a hash collision, which serializes and
-- changes no count. a transaction-level lock (safe behind a transaction pooler), held until the
-- transaction ends and taken again for free within it: an upsert takes it in its before insert
-- trigger, before any row lock, and its progress event takes it again

-- ---------------------------------------------------------------------------
-- library entries: at most max_entries_per_user rows per user
-- ---------------------------------------------------------------------------

-- refuses the insert of a new key for a user who already holds max_entries_per_user rows, with
-- TZ001 and the fixed message 'library entry limit reached'. an insert of a key the user already
-- holds is let through without a count: it becomes the update of an upsert (postgrest's save, the
-- guest merge, the replay), or a 23505, so a write of an existing key at the cap keeps working.
-- it applies to every insert path: the api, and private.write_client_library_entry under the
-- guest merge and the replay, whose call then fails whole (one transaction).
--
-- security invoker: the count must cover every row of new.user_id, and every role that inserts
-- sees them all. an api insert holds user_id = auth.uid() (authenticated has no privilege on the
-- column, so it takes its default) and rls shows that role exactly the rows of auth.uid(); the
-- definer functions (owner postgres) and the server roles bypass rls. definer rights would add
-- nothing. the count reads at most max_entries_per_user rows (limit), so a user over the cap from
-- before this migration costs no more
create function private.enforce_library_entry_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- the rows of one user at most: LIBRARY_ENTRIES_PER_USER_MAX (src/core/domain/database-limits.ts)
  -- mirrors it and must stay equal to it
  max_entries_per_user constant integer := 10000;
  -- the first key of the per-user lock (the ascii bytes of 'TZLB'): the same as in
  -- private.trim_progress_events
  library_lock_namespace constant integer := 1415203906;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    library_lock_namespace, pg_catalog.hashtext(new.user_id::text)
  );
  if exists (
    select 1
    from public.library_entries as stored
    where stored.user_id = new.user_id
      and stored.id_namespace = new.id_namespace
      and stored.media_kind = new.media_kind
      and stored.external_id = new.external_id
  ) then
    return new;
  end if;
  if (
    select pg_catalog.count(*)
    from (
      select 1
      from public.library_entries as stored
      where stored.user_id = new.user_id
      limit max_entries_per_user
    ) as counted
  ) >= max_entries_per_user then
    -- LIBRARY_ENTRY_LIMIT_CODE (src/core/repositories/supabase/library-error-mapper.ts) names it
    raise exception 'library entry limit reached' using errcode = 'TZ001';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_library_entry_cap() from public, anon, authenticated;

-- before private.set_library_entry_updated_at (triggers fire in name order): a refused insert
-- stops first
create trigger library_entries_enforce_cap
  before insert on public.library_entries
  for each row execute function private.enforce_library_entry_cap();

-- ---------------------------------------------------------------------------
-- progress events: the max_events_per_user most recent per user
-- ---------------------------------------------------------------------------

-- the order of the trim, (created_at desc, id desc): the events of one transaction share their
-- created_at, and id breaks the tie. it replaces progress_events_user_created_idx, a prefix of it
create index progress_events_user_created_id_idx
  on public.progress_events (user_id, created_at desc, id desc);

drop index public.progress_events_user_created_idx;

-- deletes the events of new.user_id past the max_events_per_user most recent, in the order
-- (created_at desc, id desc), after each insert: the new event is the most recent, so it is kept,
-- and the oldest go. it never raises for the cap. it reads at most max_events_per_user + 1 index
-- entries of that user per insert (the index above), plus the rows it deletes.
--
-- security invoker: events are inserted only by private.log_progress_event, security definer
-- owned by postgres, so this trigger runs as postgres, which may delete them; anon and
-- authenticated have no insert or delete privilege on progress_events (select only), and the
-- server roles that may insert may delete too. definer rights would add nothing
create function private.trim_progress_events()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- the events kept per user, the most recent ones
  max_events_per_user constant integer := 10000;
  -- the first key of the per-user lock (the ascii bytes of 'TZLB'): the same as in
  -- private.enforce_library_entry_cap
  library_lock_namespace constant integer := 1415203906;
begin
  -- without it, two transactions of one user would each keep the most recent of the rows they
  -- see, without the other's new event, and leave one more
  perform pg_catalog.pg_advisory_xact_lock(
    library_lock_namespace, pg_catalog.hashtext(new.user_id::text)
  );
  delete from public.progress_events as event
  using (
    select older.id
    from public.progress_events as older
    where older.user_id = new.user_id
    order by older.created_at desc, older.id desc
    offset max_events_per_user
  ) as excess
  where event.id = excess.id;
  return null;
end;
$$;

revoke execute on function private.trim_progress_events() from public, anon, authenticated;

create trigger progress_events_trim
  after insert on public.progress_events
  for each row execute function private.trim_progress_events();
