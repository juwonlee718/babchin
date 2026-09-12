-- Bobchin uses Supabase anonymous Auth so the UI can stay name-only while
-- every browser session still receives a stable auth.uid() for RLS.
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 20),
  invite_code text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint friendships_not_self check (user_id <> friend_id)
);

create index friendships_friend_id_idx on public.friendships(friend_id);

create table public.locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  sharing boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint locations_coordinates_pair check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  constraint locations_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint locations_longitude_range check (longitude is null or longitude between -180 and 180),
  constraint locations_sharing_coordinates check (not sharing or (latitude is not null and longitude is not null)),
  constraint locations_campus_bounds check (
    not sharing
    or (latitude between 37.441 and 37.472 and longitude between 126.935 and 126.965)
  )
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_name text not null check (char_length(btrim(course_name)) between 1 and 40),
  starts_at time not null,
  room text not null check (char_length(btrim(room)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schedules_user_time_idx on public.schedules(user_id, starts_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger schedules_set_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

-- Every exposed table has RLS enabled. Grants and policies are both explicit.
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.locations enable row level security;
alter table public.schedules enable row level security;

revoke all on table public.profiles, public.friendships, public.locations, public.schedules from anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, delete on table public.friendships to authenticated;
grant select, insert, update, delete on table public.locations to authenticated;
grant select, insert, update, delete on table public.schedules to authenticated;

create policy "profiles_select_self_or_friend"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.friendships f
    where f.user_id = (select auth.uid()) and f.friend_id = profiles.id
  )
);

create policy "profiles_insert_self"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "profiles_update_self"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "profiles_delete_self"
on public.profiles for delete to authenticated
using (id = (select auth.uid()));

create policy "friendships_select_own"
on public.friendships for select to authenticated
using (user_id = (select auth.uid()));

create policy "friendships_delete_own"
on public.friendships for delete to authenticated
using (user_id = (select auth.uid()));

create policy "locations_select_self_or_friend"
on public.locations for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.friendships f
    where f.user_id = (select auth.uid()) and f.friend_id = locations.user_id
  )
);

create policy "locations_insert_self"
on public.locations for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "locations_update_self"
on public.locations for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "locations_delete_self"
on public.locations for delete to authenticated
using (user_id = (select auth.uid()));

create policy "schedules_select_own"
on public.schedules for select to authenticated
using (user_id = (select auth.uid()));

create policy "schedules_insert_own"
on public.schedules for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "schedules_update_own"
on public.schedules for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "schedules_delete_own"
on public.schedules for delete to authenticated
using (user_id = (select auth.uid()));

-- Invite acceptance must atomically create both directions. It only accepts a
-- capability-style invite code and never exposes unrestricted profile lookup.
create or replace function public.accept_friend_invite(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_friend_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  select id into v_friend_id
  from public.profiles
  where invite_code = lower(btrim(p_invite_code));

  if v_friend_id is null then
    raise exception using errcode = 'P0002', message = '유효하지 않은 초대 링크예요.';
  end if;

  if v_friend_id = v_user_id then
    raise exception using errcode = '22023', message = '내 초대 링크는 사용할 수 없어요.';
  end if;

  insert into public.friendships (user_id, friend_id)
  values (v_user_id, v_friend_id), (v_friend_id, v_user_id)
  on conflict do nothing;

  return v_friend_id;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  delete from public.friendships
  where (user_id = v_user_id and friend_id = p_friend_id)
     or (user_id = p_friend_id and friend_id = v_user_id);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.accept_friend_invite(text) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.accept_friend_invite(text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
