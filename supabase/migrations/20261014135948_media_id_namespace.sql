-- media identity is the id namespace, not the server that serves it (ADR-0013): a library entry
-- is keyed by (id_namespace, media_kind, external_id), so switching to another jikan v4 compatible
-- instance keeps every entry. mal_id becomes external_id; its integer type still caps it at
-- 2147483647 = EXTERNAL_ID_MAX in src/core/domain/media.ts

create type public.media_id_namespace as enum ('mal');

-- column-level grants and the check constraint follow the renamed column
alter table public.library_entries rename column mal_id to external_id;

alter table public.library_entries
  rename constraint library_entries_mal_id_check to library_entries_external_id_check;

-- the default fills existing rows, all of which hold mal ids, then goes away, so every write
-- names its namespace
alter table public.library_entries
  add column id_namespace public.media_id_namespace not null default 'mal';

alter table public.library_entries alter column id_namespace drop default;

-- also covers the user_id foreign key
alter table public.library_entries
  drop constraint library_entries_user_media_key,
  add constraint library_entries_user_media_key unique (user_id, id_namespace, media_kind, external_id);

-- writable like media_kind and external_id, because postgrest upserts list every payload column in
-- do update set
grant insert (id_namespace), update (id_namespace) on public.library_entries to authenticated;
