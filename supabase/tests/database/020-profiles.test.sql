-- profiles: created on sign-up, read and updated by their owner only (preferences only), never
-- inserted or deleted through the api, no anon access
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- setup as postgres: a sign-up inserts into auth.users, the trigger creates the profile
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.test');

select results_eq(
  $$ select preferences from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  $$ values ('{}'::jsonb) $$,
  'sign-up creates exactly one profile, with empty preferences'
);

-- now() is fixed for the transaction: replace the owner's profile with a backdated copy so the
-- updated_at trigger has something to bump
delete from public.profiles where id = '00000000-0000-0000-0000-000000000001';
insert into public.profiles (id, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000001', '2000-01-01', '2000-01-01');

-- owner
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select id from public.profiles $$,
  $$ values ('00000000-0000-0000-0000-000000000001'::uuid) $$,
  'the owner reads their own profile only'
);

select results_eq(
  $$
    update public.profiles
    set preferences = '{"theme":"dark"}'
    where id = '00000000-0000-0000-0000-000000000001'
    returning preferences
  $$,
  $$ values ('{"theme":"dark"}'::jsonb) $$,
  'the owner updates their preferences'
);

select ok(
  (
    select updated_at > '2000-01-01'::timestamptz
    from public.profiles
    where id = '00000000-0000-0000-0000-000000000001'
  ),
  'an update bumps updated_at'
);

select is_empty(
  $$
    update public.profiles
    set preferences = '{"theme":"dark"}'
    where id = '00000000-0000-0000-0000-000000000002'
    returning id
  $$,
  'the owner cannot update another user''s profile'
);

select throws_ok(
  $$ insert into public.profiles (id) values ('00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a profile cannot be inserted through the api'
);

select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'a profile cannot be deleted through the api'
);

select throws_ok(
  $$
    update public.profiles
    set id = '00000000-0000-0000-0000-000000000002'
    where id = '00000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  null,
  'the profile id cannot be updated'
);

select throws_ok(
  $$
    update public.profiles
    set preferences = '[]'
    where id = '00000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  null,
  'preferences must be a json object'
);

-- jsonb renders {"p": "<n characters>"} as n + 9 bytes
select lives_ok(
  $$
    update public.profiles
    set preferences = jsonb_build_object('p', repeat('a', 4087))
    where id = '00000000-0000-0000-0000-000000000001'
  $$,
  'preferences of 4096 bytes are accepted'
);

select throws_ok(
  $$
    update public.profiles
    set preferences = jsonb_build_object('p', repeat('a', 4088))
    where id = '00000000-0000-0000-0000-000000000001'
  $$,
  '23514',
  null,
  'preferences over 4096 bytes are rejected'
);

-- verification as postgres
reset role;

select results_eq(
  $$ select preferences from public.profiles where id = '00000000-0000-0000-0000-000000000002' $$,
  $$ values ('{}'::jsonb) $$,
  'the other user''s profile is unchanged'
);

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ select id from public.profiles $$,
  '42501',
  null,
  'anon cannot read profiles'
);

select * from finish();

rollback;
