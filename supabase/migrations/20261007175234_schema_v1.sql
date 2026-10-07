-- schema v1: profiles, library entries and progress history, with rls and least-privilege grants.
-- see docs/ARCHITECTURE.md §5 for the data model rationale.

-- ---------------------------------------------------------------------------
-- private schema: not exposed by the api, holds every function
-- ---------------------------------------------------------------------------

create schema private;

revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type public.media_kind as enum ('anime', 'manga');

create type public.library_status as enum ('current', 'planned', 'completed', 'paused', 'dropped');

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- theme, language, show adult content
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_preferences_object_check check (jsonb_typeof(preferences) = 'object'),
  -- caps storage abuse; the shape is validated with zod on read
  constraint profiles_preferences_size_check check (octet_length(preferences::text) <= 4096)
);

-- ---------------------------------------------------------------------------
-- library entries: one row per user and media, with a per-user media snapshot
-- ---------------------------------------------------------------------------

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  media_kind public.media_kind not null,
  -- the integer type caps it at 2147483647 = MAL_ID_MAX in src/core/domain/media.ts
  mal_id integer not null,
  -- per-user snapshot of the media, refreshed when the detail screen is viewed
  media_title text not null,
  media_image_url text,
  media_format text not null,
  media_total_units integer,
  media_is_adult boolean not null default false,
  status public.library_status not null default 'planned',
  progress integer not null default 0,
  score smallint,
  notes text,
  is_favorite boolean not null default false,
  started_at date,
  finished_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_entries_mal_id_check check (mal_id > 0),
  constraint library_entries_media_title_check check (char_length(media_title) between 1 and 500),
  constraint library_entries_media_image_url_check check (
    media_image_url like 'https://%' and char_length(media_image_url) <= 2048
  ),
  constraint library_entries_media_format_check check (char_length(media_format) between 1 and 32),
  constraint library_entries_media_total_units_check check (media_total_units > 0),
  -- progress floor (BR-01). no progress <= media_total_units check on purpose: a snapshot refresh
  -- must never fail when the provider total drops; the upper bound is enforced in the domain on
  -- user edits
  constraint library_entries_progress_check check (progress >= 0),
  -- score range (BR-07)
  constraint library_entries_score_check check (score between 1 and 10),
  -- notes length (BR-07)
  constraint library_entries_notes_check check (char_length(notes) <= 2000),
  -- also covers the user_id foreign key
  constraint library_entries_user_media_key unique (user_id, media_kind, mal_id)
);

create index library_entries_user_status_idx on public.library_entries (user_id, status);

create index library_entries_user_updated_idx on public.library_entries (user_id, updated_at desc);

create index library_entries_user_favorite_idx on public.library_entries (user_id) where is_favorite;

-- ---------------------------------------------------------------------------
-- progress events: progress history for future statistics, written by trigger only
-- ---------------------------------------------------------------------------

create table public.progress_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.library_entries (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  from_progress integer not null,
  to_progress integer not null,
  created_at timestamptz not null default now()
);

create index progress_events_entry_idx on public.progress_events (entry_id);

create index progress_events_user_created_idx on public.progress_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- functions and triggers
-- ---------------------------------------------------------------------------

-- keeps updated_at server-controlled; client values are overwritten
create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger library_entries_set_updated_at
  before update on public.library_entries
  for each row execute function private.set_updated_at();

-- security definer: clients have no insert grant or policy on progress_events, so the api can
-- never write events; only this trigger can
create function private.log_progress_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.progress_events (entry_id, user_id, from_progress, to_progress)
  values (new.id, new.user_id, old.progress, new.progress);
  return new;
end;
$$;

revoke execute on function private.log_progress_event() from public, anon, authenticated;

-- no insert trigger on purpose: logging an insert or a guest merge would invent history
create trigger library_entries_log_progress
  after update of progress on public.library_entries
  for each row
  when (old.progress is distinct from new.progress)
  execute function private.log_progress_event();

-- security definer: auth inserts users as its own role, which has no grant on public.profiles.
-- never reads raw_user_meta_data, which the user controls at sign-up
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- row level security: one policy per command, authenticated only, anon has none
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.library_entries enable row level security;
alter table public.progress_events enable row level security;

-- no insert or delete policy: the row is created by on_auth_user_created and removed by cascade
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy library_entries_select_own on public.library_entries
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy library_entries_insert_own on public.library_entries
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy library_entries_update_own on public.library_entries
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy library_entries_delete_own on public.library_entries
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- read only: events are written by library_entries_log_progress
create policy progress_events_select_own on public.progress_events
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- grants: least privilege, fail closed. service_role keeps the supabase defaults
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- a future table or sequence without explicit grants is unreachable instead of exposed.
-- postgres grants execute on functions to public globally and a per-schema default cannot
-- remove a global one, so every function still needs its own revoke; functions in private
-- are also unreachable because no api role has usage on that schema
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke all on functions from public, anon, authenticated;

-- profiles: read own row, edit preferences only
grant select on public.profiles to authenticated;
grant update (preferences) on public.profiles to authenticated;

-- library entries: every column except id, user_id, created_at and updated_at is writable.
-- media_kind and mal_id stay writable because postgrest upserts list every payload column in
-- do update set
grant select, delete on public.library_entries to authenticated;
grant insert (
  media_kind,
  mal_id,
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
  finished_at
) on public.library_entries to authenticated;
grant update (
  media_kind,
  mal_id,
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
  finished_at
) on public.library_entries to authenticated;

-- progress events: read only
grant select on public.progress_events to authenticated;
