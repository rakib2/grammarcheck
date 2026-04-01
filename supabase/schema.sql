-- ============================================================
-- GrammarCoach – Supabase schema
-- Run this in the Supabase SQL Editor to bootstrap the database.
-- ============================================================

-- 1. profiles
create table if not exists profiles (
  id              uuid        references auth.users on delete cascade primary key,
  native_language text,
  cefr_level      text        check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  level           integer     not null default 1,
  xp              integer     not null default 0,
  streak          integer     not null default 0,
  last_active     date,
  tier            text        not null default 'free'
                              check (tier in ('free', 'pro')),
  tokens_used     integer     not null default 0
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2. attempts
create table if not exists attempts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references profiles(id) on delete cascade,
  sentence      text        not null,
  topic         text        not null,
  score         integer     not null,
  error_types   text[]      not null default '{}',
  created_at    timestamptz not null default now()
);

alter table attempts enable row level security;

create policy "Users can read own attempts"
  on attempts for select
  using (auth.uid() = user_id);

create policy "Users can insert own attempts"
  on attempts for insert
  with check (auth.uid() = user_id);

-- 3. mistakes
create table if not exists mistakes (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references profiles(id) on delete cascade,
  error_type    text        not null,
  word          text        not null,
  correction    text,
  topic         text        not null,
  created_at    timestamptz not null default now()
);

alter table mistakes enable row level security;

create policy "Users can read own mistakes"
  on mistakes for select
  using (auth.uid() = user_id);

create policy "Users can insert own mistakes"
  on mistakes for insert
  with check (auth.uid() = user_id);

-- 4. user_progress (per-user per-lesson state)
create table if not exists user_progress (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references profiles(id) on delete cascade,
  lesson_id     text        not null,
  status        text        not null default 'locked'
                            check (status in ('locked','available','in_progress','completed')),
  phase         text        not null default 'teach'
                            check (phase in ('teach','drill','write','review')),
  drill_score   integer,
  write_score   integer,
  completed_at  timestamptz,
  unique(user_id, lesson_id)
);

alter table user_progress enable row level security;

create policy "Users can read own progress"
  on user_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert own progress"
  on user_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update own progress"
  on user_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. placement_results
create table if not exists placement_results (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references profiles(id) on delete cascade,
  assigned_level  text        not null
                              check (assigned_level in ('A1','A2','B1','B2','C1','C2')),
  answers         jsonb       not null default '[]',
  total_score     integer     not null,
  created_at      timestamptz not null default now()
);

alter table placement_results enable row level security;

create policy "Users can read own placement"
  on placement_results for select
  using (auth.uid() = user_id);

create policy "Users can insert own placement"
  on placement_results for insert
  with check (auth.uid() = user_id);

-- Grant table access to PostgREST roles
grant usage on schema public to anon, authenticated;
grant select, insert, update on profiles to authenticated;
grant select, insert on attempts to authenticated;
grant select, insert on mistakes to authenticated;
grant select, insert, update on user_progress to authenticated;
grant select, insert on placement_results to authenticated;
grant select on profiles to anon;
grant select on attempts to anon;
grant select on mistakes to anon;
grant select on user_progress to anon;
grant select on placement_results to anon;
