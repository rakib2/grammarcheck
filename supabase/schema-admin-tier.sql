-- ============================================================
-- GrammarCoach – add 'admin' tier to profiles.tier
-- Idempotent. Run after schema.sql.
--
-- After running, promote yourself to admin (replace with your email):
--   update profiles
--   set tier = 'admin'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ============================================================

alter table profiles
  drop constraint if exists profiles_tier_check;

alter table profiles
  add constraint profiles_tier_check
  check (tier in ('free', 'pro', 'admin'));
