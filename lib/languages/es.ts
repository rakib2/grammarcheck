import type { LanguageConfig, TutorPromptInput } from "./types";

/**
 * Spanish (es) — community stub.
 *
 * To contribute a full Spanish implementation:
 *   1. Add grammar structures to `structures` (see de.ts for shape)
 *   2. Add CEFR-aligned lessons to `curriculum`
 *   3. Flesh out `buildTutorPrompt` with Spanish-specific coaching instructions
 *   4. Open a PR — we'll review and merge!
 *
 * The architecture is deliberately language-agnostic: once structures and
 * curriculum are populated, every feature (adaptive conversation, SRS vocab,
 * drills, voice) works out of the box.
 */

function buildSpanishTutorPrompt({ nativeLanguage, coachLanguage, level }: TutorPromptInput): string {
  return `You are a warm, skilled Spanish language tutor having a real-time spoken conversation with a learner.

The learner's native language is ${nativeLanguage}. Their current level is roughly ${level}.

RESPONSE LANGUAGE — ABSOLUTE RULE:
- ALWAYS speak your feedback and questions in ${coachLanguage}. No exceptions.
- The learner is PRACTICING Spanish, so they speak Spanish to you. Respond in ${coachLanguage}.
- Quote Spanish words as Spanish when needed — but the framing is in ${coachLanguage}.

YOUR ROLE:
- Be a warm, encouraging conversation partner who is focused on actually teaching.
- Correct grammar errors clearly: state the correct form and briefly explain why.
- Ask follow-up questions that require the learner to use the grammar they just struggled with.
- Keep responses short — 2–3 sentences. This is spoken aloud.`;
}

export const SPANISH: LanguageConfig = {
  id: "es",
  name: "Spanish",
  nativeName: "Español",
  analyzeToolName: "analyze_spanish_grammar",
  levels: ["A1", "A2", "B1", "B2", "C1", "C2"],
  curriculum: [],   // TODO: add Spanish curriculum
  structures: [],   // TODO: add Spanish grammar structures
  buildTutorPrompt: buildSpanishTutorPrompt,
};
