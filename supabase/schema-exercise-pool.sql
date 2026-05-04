-- ============================================================
-- GrammarCoach – Exercise pool schema
-- Run this AFTER schema.sql (needs profiles). Idempotent.
--
-- Per-user, per-topic queue of pre-generated exercises. The chat/study UI
-- reads `pending` rows for an instant render, then fires a background refill
-- when the pool runs low. Claude is never on the user's hot path after the
-- first cold-start visit.
--
-- Same dual-tier shape as `vocabulary_items`: Supabase is source of truth,
-- localStorage mirrors the slice for offline / fast-refresh.
--
-- One table covers all kinds (drill / translate / error_spot / story /
-- worksheet) — lifecycle is identical, the `kind` column + `payload` jsonb
-- carry the variation. Worksheet feature reuses this table later.
-- ============================================================

create table if not exists exercise_pool (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references profiles(id) on delete cascade,

  -- Scope
  language        text        not null default 'de',
  topic_id        text        not null,
  kind            text        not null
                              check (kind in (
                                'drill','translate','error_spot','story','worksheet'
                              )),

  -- The exercise itself. Shape depends on kind; client code does the
  -- destructuring. Examples:
  --   drill:       { mode, prompt, expectedAnswer, hint, targetSkill }
  --   translate:   { english, germanReference, hints }
  --   error_spot:  { brokenSentence, correction, explanation }
  payload         jsonb       not null,

  -- Hash of the canonical prompt — used for in-batch dedup and for
  -- diversity checks against the last N generations.
  payload_hash    text        not null,

  -- Evaluation strategy. The dispatcher in lib/exercisePool.ts uses this
  -- to decide whether to grade locally (fast) or call the LLM eval route.
  --   exact_match     — normalized string equality vs eval_spec.answer
  --   set_membership  — answer ∈ eval_spec.acceptable[]
  --   regex           — eval_spec.pattern matches (case-insensitive)
  --   llm             — fall through to /api/lesson/eval
  eval_kind       text        not null
                              check (eval_kind in (
                                'exact_match','set_membership','regex','llm'
                              )),
  eval_spec       jsonb       not null default '{}'::jsonb,

  -- Lifecycle
  --   pending    — generated, not yet shown to the user
  --   served     — rendered in the UI; awaiting submission
  --   submitted  — user answered; score recorded
  --   retired    — superseded / aged out (kept for analytics)
  status          text        not null default 'pending'
                              check (status in (
                                'pending','served','submitted','retired'
                              )),
  batch_id        uuid        not null,

  -- Timestamps + outcome
  generated_at    timestamptz not null default now(),
  served_at       timestamptz,
  submitted_at    timestamptz,
  score           real,

  -- Within a single batch, the same prompt should never appear twice.
  -- Across batches we tolerate eventual repetition (the diversity check
  -- in the generator avoids it in practice).
  unique(user_id, topic_id, batch_id, payload_hash)
);

-- Hot path: "give me the next N pending exercises for this user+topic"
create index if not exists exercise_pool_pending_idx
  on exercise_pool (user_id, topic_id, status, generated_at)
  where status in ('pending','served');

-- Diversity / dedup lookup: "what hashes did we generate recently for this user+topic?"
create index if not exists exercise_pool_recent_hash_idx
  on exercise_pool (user_id, topic_id, generated_at desc);

-- Analytics: "submitted answers, sorted by recency" — used for refill heuristics
create index if not exists exercise_pool_submitted_idx
  on exercise_pool (user_id, topic_id, submitted_at desc)
  where status = 'submitted';

-- ── Row-level security ─────────────────────────────────────
alter table exercise_pool enable row level security;

drop policy if exists "Users can manage own exercise pool" on exercise_pool;
create policy "Users can manage own exercise pool"
  on exercise_pool for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on exercise_pool to authenticated;
