-- ============================================================
-- GrammarFlow – Session history schema (clean rebuild)
-- Run this AFTER schema.sql (needs profiles). Safe to re-run.
--
-- Two tables, both keyed by (user_id, session_number):
--   • mastery_snapshots — aggregate state at the end of each session
--     (drives the activity heatmap on / and the trend chart on /progress)
--   • session_summaries — recap-style narrative + deltas for /session/recap
--     and the session list on /progress
--
-- DESTRUCTIVE: drops both tables and any stale partial state from earlier
-- attempts before recreating. Only safe because the sync layer is brand
-- new and these tables have no production data yet. Don't run this if
-- you've been writing real session history into them — back up first.
-- ============================================================

drop table if exists mastery_snapshots cascade;
drop table if exists session_summaries cascade;

-- ── Snapshots ──────────────────────────────────────────────
create table mastery_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references profiles(id) on delete cascade,
  session_number        integer     not null,
  recorded_at           timestamptz not null default now(),
  detected_level        text        not null,
  total_turns           integer     not null default 0,
  structures            jsonb       not null default '[]',
  error_counts          jsonb       not null default '[]',
  avg_mastery           real        not null default 0.0,
  total_errors          integer     not null default 0,
  structures_discovered integer     not null default 0,
  structures_mastered   integer     not null default 0,
  constraint mastery_snapshots_user_session_uniq unique (user_id, session_number),
  constraint mastery_snapshots_level_chk check (detected_level in ('A1','A2','B1','B2','C1','C2')),
  constraint mastery_snapshots_total_turns_chk check (total_turns >= 0),
  constraint mastery_snapshots_avg_mastery_chk check (avg_mastery >= 0.0 and avg_mastery <= 1.0),
  constraint mastery_snapshots_total_errors_chk check (total_errors >= 0),
  constraint mastery_snapshots_struct_disc_chk check (structures_discovered >= 0),
  constraint mastery_snapshots_struct_mast_chk check (structures_mastered >= 0)
);

create index mastery_snapshots_recorded_idx
  on mastery_snapshots (user_id, recorded_at desc);

alter table mastery_snapshots enable row level security;

create policy "Users can manage own snapshots"
  on mastery_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on mastery_snapshots to authenticated;

-- ── Summaries ──────────────────────────────────────────────
create table session_summaries (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references profiles(id) on delete cascade,
  session_number      integer     not null,
  recorded_at         timestamptz not null default now(),
  turn_count          integer     not null default 0,
  structures_practiced text[]     not null default '{}',
  errors_this_session integer     not null default 0,
  mastery_deltas      jsonb       not null default '[]',
  summary_text        text        not null default '',
  top_strength        text,
  top_weakness        text,
  constraint session_summaries_user_session_uniq unique (user_id, session_number),
  constraint session_summaries_turn_count_chk check (turn_count >= 0),
  constraint session_summaries_errors_chk check (errors_this_session >= 0)
);

create index session_summaries_recorded_idx
  on session_summaries (user_id, recorded_at desc);

alter table session_summaries enable row level security;

create policy "Users can manage own summaries"
  on session_summaries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on session_summaries to authenticated;
