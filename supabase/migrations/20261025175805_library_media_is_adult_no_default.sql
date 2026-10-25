-- BR-06: a missing media_is_adult would fail open as false and show an adult title with the
-- setting off, so every write names it, like id_namespace. no existing row changes
alter table public.library_entries alter column media_is_adult drop default;
