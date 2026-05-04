import { getLanguageConfig } from "@/lib/languages";

/**
 * Shared instructions builder for the OpenAI Realtime voice session.
 *
 * Used in two places:
 *  1. /api/realtime/session creates a new session with these instructions.
 *  2. app/page.tsx pushes a `session.update` event with these instructions
 *     whenever the learner changes their coach language mid-session — so
 *     the live coach switches language immediately instead of staying in
 *     the language it was born with.
 *
 * The actual prompt text lives in the per-language config under
 * `lib/languages/<code>.ts`. This file just routes to the right one.
 *
 * Keep this pure (no side effects, no env reads) so both caller paths
 * produce identical prompts from the same inputs.
 */
export interface RealtimeInstructionsInput {
  nativeLanguage: string;
  coachLanguage: string;
  level: string; // CEFR level like "A1", "B2"
  /**
   * ISO 639-1 code of the language being studied. Defaults to the registry
   * default (currently "de") so legacy callers without target-language
   * awareness still get the right prompt.
   */
  targetLanguage?: string;
}

export function buildRealtimeInstructions({
  nativeLanguage,
  coachLanguage,
  level,
  targetLanguage,
}: RealtimeInstructionsInput): string {
  const language = getLanguageConfig(targetLanguage);
  return language.buildTutorPrompt({ nativeLanguage, coachLanguage, level });
}
