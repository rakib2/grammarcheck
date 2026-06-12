# GrammarFlow

**Open-source AI language tutor that actually teaches grammar.**

GrammarFlow is what happens when you replace Duolingo's gamified vocabulary drills with a real AI conversation partner that tracks every grammar mistake you make, explains why it's wrong, and adapts every session to your specific weaknesses.

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rakib2/grammarcheck&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ANTHROPIC_API_KEY,OPENAI_API_KEY)

---

## Why not Duolingo?

| | Duolingo | GrammarFlow |
|---|---|---|
| Teaching method | Fixed exercises | Live AI conversation |
| Grammar feedback | None | Token-by-token analysis |
| Adapts to you | No | Tracks 60+ grammar structures per learner |
| Voice conversation | No | Real-time WebRTC (OpenAI Realtime API) |
| Explains errors | Rarely | Always, in your native language |
| Curriculum | Vocabulary-first | Grammar-first, CEFR A1–C2 |
| Spaced repetition | Gamified streaks | SM-2 for grammar AND vocabulary |
| Open source | No | Yes — deploy with your own API keys |

Duolingo is great at keeping you coming back. It's not great at teaching you to actually speak.

---

## How it works

### The Adaptive Conversation Loop (ACL)

Every message you send goes through a five-stage pipeline:

```
OBSERVE → DIAGNOSE → ENGAGE → CORRECT → REINFORCE
```

1. **OBSERVE** — Claude analyzes your sentence token-by-token and identifies which of 60+ grammar structures you used and whether they were correct.
2. **DIAGNOSE** — Your learner model updates: mastery scores rise for correct uses, fall for errors. SM-2 scheduling determines what to drill next.
3. **ENGAGE** — The coach responds to what you *said* first (not just marking it), then teaches the most important correction.
4. **CORRECT** — Errors are explained in your native language, with direct comparison to how your L1 handles the same concept.
5. **REINFORCE** — The next prompt is chosen to make you use the structure you just got wrong again.

### Learner model

Every learner has a per-structure mastery score (0.0–1.0) for 60+ German grammar structures:

```
a1_word_order_svo, a1_verb_conjugation, a1_articles, a1_nominative,
a2_accusative, a2_dative, a2_modal_verbs, a2_separable_verbs,
b1_relative_clauses, b1_konjunktiv_ii, b1_passive, b2_konjunktiv_i,
c1_partizipialkonstruktionen, c1_funktionsverbgefuege, ...
```

The model persists across sessions. After five sessions, GrammarFlow knows more about your German than your teacher does.

### Architecture

```
Next.js 14 (App Router)
├── /app/api/converse          ← Streaming ACL via Claude (Anthropic)
├── /app/api/realtime/session  ← WebRTC Realtime via OpenAI
├── /app/api/tts               ← TTS via OpenAI
├── /app/api/voice/transcribe  ← Whisper STT
├── /app/api/lesson/session    ← Adaptive lesson plan generation
└── /app/api/placement         ← CEFR level placement test

Supabase (Postgres + Auth + RLS)
├── profiles       ← user settings, tier, CEFR level
├── user_progress  ← per-lesson state, phase, scores
├── mastery_snapshots ← cross-session grammar mastery history
└── vocabulary_items  ← personal SRS vocab deck (SM-2)

lib/
├── languages/     ← pluggable language configs (German full, stubs for ES/FR)
├── conversationEngine.ts  ← ACL core logic
├── grammarStructures.ts   ← 60+ grammar structure definitions
├── spacedRepetition.ts    ← SM-2 scheduler
└── anthropic.ts           ← Claude integration + streaming
```

### Language architecture

GrammarFlow is German-first but architecturally language-agnostic. Adding a new language means one file:

```typescript
// lib/languages/es.ts
export const SPANISH: LanguageConfig = {
  id: "es",
  name: "Spanish",
  structures: [...],    // your grammar structure list
  curriculum: [...],    // CEFR-aligned lessons
  buildTutorPrompt: (input) => `...your system prompt...`,
};
```

Register it in `lib/languages/index.ts` and every feature — conversations, drills, voice, SRS vocab, placement test — works out of the box.

**Community contributions for Spanish and French are open.** See `lib/languages/es.ts` and `lib/languages/fr.ts` for the stub files.

---

## Self-hosting

### One-click deploy

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rakib2/grammarcheck&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ANTHROPIC_API_KEY,OPENAI_API_KEY)

### Manual setup

**1. Clone and install**
```bash
git clone https://github.com/rakib2/grammarcheck
cd grammarcheck
npm install
```

**2. Set up Supabase**
- Create a project at [supabase.com](https://supabase.com)
- Run the SQL files in `/supabase/` against your project (schema.sql first, then the schema-*.sql files)
- Copy your project URL and keys

**3. Configure environment**
```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```
# Supabase — https://supabase.com/dashboard → Project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # enables rate limiting enforcement

# Anthropic — https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI — https://platform.openai.com/api-keys (optional, for voice)
OPENAI_API_KEY=sk-proj-...
```

**4. Run**
```bash
npm run dev
```

### Docker

```bash
docker-compose up
```

---

## Bring Your Own Keys (hosted)

If you're using the hosted version at grammarflow.app, go to **Settings → API Keys** and paste your Anthropic and OpenAI keys. They're stored only in your browser's localStorage and sent directly to the server on each request — never persisted in our database.

This means GrammarFlow can run at **zero marginal cost** for the operator while still being fully functional for every user.

---

## Features

- **Adaptive AI conversation** — every session tailored to your current mistakes
- **Token-level grammar analysis** — see exactly which word was wrong and why
- **60+ German grammar structures** tracked with per-structure mastery scores
- **Spaced repetition** — SM-2 for both vocabulary and grammar structures
- **Voice conversation** — real-time WebRTC via OpenAI Realtime API
- **CEFR placement test** — A1 through C2 assessment in 10 questions
- **Structured curriculum** — 60+ lessons organized by CEFR level
- **Translation drills** — English → German with AI grading
- **Error spotting** — find the grammar mistake in a sentence
- **Story completion** — write the ending using target grammar
- **Worksheets** — printable/browser fill-in-the-blank exercises
- **Vocabulary SRS** — personal deck with gender tracking (der/die/das)
- **Multi-language coach** — corrections delivered in your native language (50+ languages)
- **Progress tracking** — mastery heatmap, trend charts, session history

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| AI — grammar | Anthropic Claude (Sonnet + Haiku, smart routing) |
| AI — voice | OpenAI Realtime API (WebRTC) |
| AI — TTS | OpenAI TTS (`tts-1`, `nova` voice) |
| AI — STT | OpenAI Whisper |
| Database | Supabase (Postgres + Auth + RLS) |
| Spaced repetition | SM-2 algorithm |
| Hosting | Vercel |

---

## Contributing

### Adding a language

1. Create `lib/languages/<code>.ts` (copy `es.ts` as a template)
2. Implement `LanguageConfig`:
   - `structures: StructureDefinition[]` — grammar structures to track
   - `curriculum: CurriculumLesson[]` — CEFR-aligned lessons
   - `buildTutorPrompt(input)` — your language's system prompt
3. Register in `lib/languages/index.ts`
4. Open a PR

The hardest part is the grammar structure list — it needs to cover A1–C2 with good L1 interference notes for common native languages. Once that exists, everything else is automatic.

### Bug reports and feature requests

Open an issue at [github.com/rakib2/grammarcheck/issues](https://github.com/rakib2/grammarcheck/issues).

---

## License

MIT. Use it, fork it, build on it.
