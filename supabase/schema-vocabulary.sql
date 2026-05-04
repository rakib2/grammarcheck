-- ============================================================
-- GrammarFlow – Vocabulary deck schema
-- Run this AFTER schema.sql (needs profiles). Idempotent.
--
-- Each row is one word/lemma in a learner's personal SRS deck. The card
-- content (lemma, example, translation) plus the SRS scheduling state
-- (interval, ease_factor, due_at) all live in one table — there's no
-- review-history audit log yet, just the latest state.
--
-- Schema mirrors lib/vocabulary.ts (the localStorage shape) so the same
-- types/code can swap to Supabase via a sync helper similar to
-- lib/learnerModelSync.ts.
-- ============================================================

create table if not exists vocabulary_items (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references profiles(id) on delete cascade,

  -- Lemma identity
  lemma             text        not null,
  inflection        text,
  part_of_speech    text        not null
                                check (part_of_speech in (
                                  'noun','verb','adjective','adverb',
                                  'preposition','particle','phrase'
                                )),
  gender            text        check (gender in ('der','die','das')),
  plural            text,
  cefr_level        text        not null
                                check (cefr_level in ('A1','A2','B1','B2','C1','C2')),
  -- Optional link to a grammar structure id (e.g. 'a2_akkusativ').
  -- Not a foreign key — grammar structures live in code, not in the DB.
  structure_id      text,

  -- Card content
  example_sentence  text        not null,
  l1_translation    text        not null,

  -- SRS state (SM-2-style schedule; see lib/vocabulary.gradeVocabulary)
  introduced        timestamptz not null default now(),
  last_reviewed    timestamptz,
  due_at            timestamptz not null default now(),
  interval_days     integer     not null default 0
                                check (interval_days >= 0),
  ease_factor       real        not null default 2.5
                                check (ease_factor >= 1.3 and ease_factor <= 3.0),
  repetitions       integer     not null default 0
                                check (repetitions >= 0),
  lapses            integer     not null default 0
                                check (lapses >= 0),

  -- One row per lemma per learner. If the AI proposes "essen" twice, the
  -- second insert is suppressed (or used to refresh the example).
  unique(user_id, lemma)
);

-- Hot path: "give me everything that's due for this user, ordered by oldest first"
create index if not exists vocabulary_items_due_idx
  on vocabulary_items (user_id, due_at);

-- Useful for filters by structure (related-vocab block on /study/<id>)
create index if not exists vocabulary_items_structure_idx
  on vocabulary_items (user_id, structure_id)
  where structure_id is not null;

-- ── Row-level security ─────────────────────────────────────
alter table vocabulary_items enable row level security;

drop policy if exists "Users can manage own vocabulary" on vocabulary_items;
create policy "Users can manage own vocabulary"
  on vocabulary_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on vocabulary_items to authenticated;
