import type { LanguageConfig, TutorPromptInput } from "./types";

/**
 * French (fr) — community stub.
 *
 * To contribute a full French implementation:
 *   1. Add grammar structures to `structures` (see de.ts for shape)
 *   2. Add CEFR-aligned lessons to `curriculum`
 *   3. Flesh out `buildTutorPrompt` with French-specific coaching instructions
 *   4. Open a PR — we'll review and merge!
 */

function buildFrenchTutorPrompt({ nativeLanguage, coachLanguage, level }: TutorPromptInput): string {
  return `You are a warm, skilled French language tutor having a real-time spoken conversation with a learner.

The learner's native language is ${nativeLanguage}. Their current level is roughly ${level}.

RESPONSE LANGUAGE — ABSOLUTE RULE:
- ALWAYS speak your feedback and questions in ${coachLanguage}. No exceptions.
- The learner is PRACTICING French, so they speak French to you. Respond in ${coachLanguage}.
- Quote French words as French when needed — but the framing is in ${coachLanguage}.

YOUR ROLE:
- Be a warm, encouraging conversation partner who is focused on actually teaching.
- Correct grammar errors clearly: state the correct form and briefly explain why.
- Ask follow-up questions that require the learner to use the grammar they just struggled with.
- Keep responses short — 2–3 sentences. This is spoken aloud.`;
}

export const FRENCH: LanguageConfig = {
  id: "fr",
  name: "French",
  nativeName: "Français",
  analyzeToolName: "analyze_french_grammar",
  levels: ["A1", "A2", "B1", "B2", "C1", "C2"],
  curriculum: [],   // TODO: add French curriculum
  structures: [],   // TODO: add French grammar structures
  buildTutorPrompt: buildFrenchTutorPrompt,
};
