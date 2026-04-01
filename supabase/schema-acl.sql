-- ============================================================
-- GrammarCoach – ACL (Adaptive Conversational Loop) schema
-- Run this AFTER the base schema.sql
-- ============================================================

-- Learner model (persistent across sessions)
create table if not exists learner_models (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        references profiles(id) on delete cascade,
  native_language text        not null,
  detected_level  text        not null default 'A1'
                              check (detected_level in ('A1','A2','B1','B2','C1','C2')),
  session_count   integer     not null default 0,
  total_turns     integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(user_id)
);

alter table learner_models enable row level security;
create policy "Users can manage own learner model"
  on learner_models for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grammar structure mastery tracking
create table if not exists structure_mastery (
  id              uuid        primary key default gen_random_uuid(),
  learner_id      uuid        not null references learner_models(id) on delete cascade,
  structure_id    text        not null,
  name            text        not null,
  cefr_level      text        not null,
  mastery         real        not null default 0.0,
  attempts        integer     not null default 0,
  last_seen       timestamptz,
  last_correct    boolean,
  unique(learner_id, structure_id)
);

alter table structure_mastery enable row level security;
create policy "Users can manage own mastery"
  on structure_mastery for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Error patterns (escalation tracking)
create table if not exists error_patterns (
  id                uuid        primary key default gen_random_uuid(),
  learner_id        uuid        not null references learner_models(id) on delete cascade,
  structure_id      text        not null,
  pattern           text        not null,
  example           text,
  correction        text,
  count             integer     not null default 1,
  correction_level  text        not null default 'recast'
                                check (correction_level in ('recast','highlight','explicit')),
  last_seen         timestamptz not null default now()
);

alter table error_patterns enable row level security;
create policy "Users can manage own error patterns"
  on error_patterns for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Spaced repetition queue
create table if not exists srs_queue (
  id              uuid        primary key default gen_random_uuid(),
  learner_id      uuid        not null references learner_models(id) on delete cascade,
  structure_id    text        not null,
  due_at          text        not null,
  interval        integer     not null default 1,
  ease_factor     real        not null default 2.5,
  repetitions     integer     not null default 0,
  unique(learner_id, structure_id)
);

alter table srs_queue enable row level security;
create policy "Users can manage own SRS queue"
  on srs_queue for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Conversation sessions (for analytics and review)
create table if not exists conversation_sessions (
  id              uuid        primary key default gen_random_uuid(),
  learner_id      uuid        not null references learner_models(id) on delete cascade,
  turns           jsonb       not null default '[]',
  structures_covered text[]   not null default '{}',
  avg_score       integer,
  created_at      timestamptz not null default now()
);

alter table conversation_sessions enable row level security;
create policy "Users can manage own sessions"
  on conversation_sessions for all
  using (
    learner_id in (select id from learner_models where user_id = auth.uid())
  )
  with check (
    learner_id in (select id from learner_models where user_id = auth.uid())
  );

-- Grants
grant select, insert, update, delete on learner_models to authenticated;
grant select, insert, update, delete on structure_mastery to authenticated;
grant select, insert, update, delete on error_patterns to authenticated;
grant select, insert, update, delete on srs_queue to authenticated;
grant select, insert on conversation_sessions to authenticated;
grant select on learner_models to anon;
grant select on structure_mastery to anon;
grant select on conversation_sessions to anon;
