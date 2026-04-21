-- ============================================================
-- GrammarCoach – Daily per-user usage tracking
-- Purpose: cap how many realtime voice sessions a user can start
-- per UTC day so a runaway user can't burn through OpenAI credit.
-- Run AFTER schema.sql, schema-acl.sql, schema-phase3.sql.
-- ============================================================

create table if not exists user_usage (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  usage_date      date        not null default (now() at time zone 'utc')::date,
  realtime_sessions_started integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table user_usage enable row level security;

-- Users can read their own usage row (useful if we want to show "X sessions left today")
create policy "Users read own usage"
  on user_usage for select
  using (user_id = auth.uid());

-- Writes happen server-side with the service role key, so no write policy for
-- authenticated/anon roles — keep them read-only.

grant select on user_usage to authenticated;
