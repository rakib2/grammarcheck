# TODOS

## Deferred from CEO Plan (2026-04-01)

### Self-hosted Supabase on EC2
**What:** Replace Supabase Cloud with self-hosted Supabase in Docker on EC2.
**Why:** Eliminates vendor costs and reduces latency for users in Germany.
**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P2
**Depends on:** Phase 2 Supabase Cloud integration must work first.
**Context:** Rakib wants to run Supabase locally via docker-compose, deploy to EC2. Schema already exists in `supabase/schema-acl.sql`. Do this after validation with 5 users proves the product works.

### OpenAI Realtime API Evaluation
**What:** Evaluate OpenAI Realtime API for full-duplex voice conversation.
**Why:** Could enable interruption, overlapping speech, more natural conversation feel.
**Effort:** S (human: ~2 days / CC: ~15min for spike)
**Priority:** P3
**Depends on:** Phase 4 validation. Only pursue if users specifically want full duplex.
**Context:** Rejected in CEO review because: (1) breaks ACL engine control ($0.30/min vs $0.35-0.75/session), (2) requires maintaining two conversation pipelines. Revisit only if 3+ users request it.

### Morning Prompt / Push Notifications
**What:** Daily nudge to practice (email, push, or SMS).
**Why:** Retention mechanism. The "tutor relationship" hypothesis depends on daily practice.
**Effort:** M (human: ~1 week / CC: ~30min)
**Priority:** P3
**Depends on:** Phase 2 auth + Supabase. Needs notification infrastructure not in current stack.

### Multi-Language Support
**What:** Expand beyond German to other languages.
**Why:** Same architecture works for any language with persistent grammar issues.
**Effort:** L (human: ~3 weeks / CC: ~2 hours)
**Priority:** P3
**Depends on:** Phase 4 validation. German must be nailed first.
**Context:** Founder's vision is to generalize. Grammar structures, L1 interference patterns, and eliciting prompts need per-language definitions.

### Naming / Rebrand
**What:** Rename from GrammarCoach to something that reflects the tutor relationship vision.
**Why:** "GrammarCoach" undersells the product. It's not a grammar checker, it's a personal tutor.
**Effort:** Zero (just naming)
**Priority:** P3
**Depends on:** Phase 4 validation. Ship as GrammarCoach, rebrand when product proves itself.

## From Eng Review (2026-04-01)

### Structured Server-Side Logging
**What:** Add JSON structured logging to /api/converse: user_id, score, errors_count, model_used (haiku/sonnet), latency_ms, structures_targeted.
**Why:** Zero observability right now. Need real data to validate whether the product works for the 5 external users in Phase 4.
**Effort:** S (human: ~4hr / CC: ~15min)
**Priority:** P2
**Depends on:** Phase 2 Supabase integration (needs user_id from auth).
**Context:** Currently only console.error exists. When Supabase auth is in, log every conversation turn with structured data. This feeds the progress visualization in Phase 3.

### Remove Unnecessary Anon Grants in Supabase Schema
**What:** Remove `GRANT SELECT ... TO anon` on learner_models, structure_mastery, conversation_sessions in schema-acl.sql.
**Why:** RLS policies use auth.uid() which returns null for anon, so data is protected. But the grants are unnecessary and confusing.
**Effort:** Zero (3 lines deleted)
**Priority:** P1
**Depends on:** Nothing. Can be done anytime.
