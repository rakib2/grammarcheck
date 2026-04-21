-- ============================================================
-- GrammarCoach – Add coach_language column to learner_models
-- Run this AFTER schema-acl.sql. Idempotent.
-- ============================================================

-- coach_language: the language the coach explains in (not the language
-- being learned). Defaults to native_language if unspecified.
alter table learner_models
  add column if not exists coach_language text;

-- Backfill existing rows to use native_language as a sensible default
update learner_models
  set coach_language = native_language
  where coach_language is null;
