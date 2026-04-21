-- ============================================================
-- GrammarCoach – Phase 3: Deep Memory + Cross-Session Intelligence
-- Run this AFTER schema.sql and schema-acl.sql
-- ============================================================

-- Mastery snapshots (point-in-time learner state per session)
create table if not exists mastery_snapshots (
  id                uuid        primary key default gen_random_uuid(),
  learner_id        uuid        not null references learner_models(id) on delete cascade,
  session_number    integer     not null,
  detected_level    text        not null,
  total_turns       integer     not null default 0,
  structures        jsonb       not null default '[]',
  error_counts      jsonb       not null default '[]',
  avg_mastery       real        not null default 0.0,
  total_errors      integer     not null default 0,
  structures_discovered integer not null default 0,
  structures_mastered   integer not null default 0,
  created_at        timestamptz not null default now()
);

alter table mastery_snapshots enable row level security;
create policy "Users can manage own snapshots"
  on mastery_snapshots for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Session summaries (tutor recap after each session)
create table if not exists session_summaries (
  id                  uuid        primary key default gen_random_uuid(),
  learner_id          uuid        not null references learner_models(id) on delete cascade,
  session_number      integer     not null,
  turn_count          integer     not null default 0,
  structures_practiced text[]     not null default '{}',
  errors_this_session integer     not null default 0,
  mastery_deltas      jsonb       not null default '[]',
  summary_text        text        not null,
  top_strength        text,
  top_weakness        text,
  created_at          timestamptz not null default now()
);

alter table session_summaries enable row level security;
create policy "Users can manage own summaries"
  on session_summaries for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Grants
grant select, insert on mastery_snapshots to authenticated;
grant select, insert on session_summaries to authenticated;
grant select on mastery_snapshots to anon;
grant select on session_summaries to anon;
