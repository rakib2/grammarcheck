-- ============================================================
-- GrammarFlow – Add target_language column to learner_models
-- Run this AFTER schema-acl.sql. Idempotent.
--
-- target_language is the ISO 639-1 code of the language the learner is
-- studying ("de", "es", "fr"). Pairs with native_language (their L1) and
-- coach_language (the language explanations are in). Defaults to "de" so
-- existing rows keep working unchanged.
-- ============================================================

alter table learner_models
  add column if not exists target_language text not null default 'de'
    check (target_language ~ '^[a-z]{2}$');

-- Backfill any pre-existing rows that somehow ended up null
update learner_models
  set target_language = 'de'
  where target_language is null;
