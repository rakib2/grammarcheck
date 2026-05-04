import type { CurriculumLesson, CefrLevel } from "@/types";
import type { StructureDefinition } from "@/lib/grammarStructures";

/**
 * Inputs available to a language's tutor prompt template.
 *
 * Kept identical across languages so swapping target language is a config
 * change, not a code change. If a language needs more vocabulary (e.g. tone
 * markers for Mandarin, gender for German), add it here as an optional field
 * and have the affected language config opt in.
 */
export interface TutorPromptInput {
  /** Learner's L1 — used for interference notes ("Bengali speakers tend to…") */
  nativeLanguage: string;
  /** Language the coach explains in (NOT the language being learned) */
  coachLanguage: string;
  /** CEFR level string ("A1" .. "C2") */
  level: string;
}

/**
 * Everything we need to teach one language.
 *
 * Adding a new language means dropping a new file under `lib/languages/<code>.ts`
 * that exports a `LanguageConfig`, then registering it in `lib/languages/index.ts`.
 * No other code in the app should hardcode a language name.
 */
export interface LanguageConfig {
  /** ISO 639-1 code, e.g. "de", "es", "fr" */
  id: string;
  /** English display name, e.g. "German" */
  name: string;
  /** Endonym, e.g. "Deutsch", "Español" */
  nativeName: string;
  /** Name of the analyze-grammar tool (Realtime function name) */
  analyzeToolName: string;
  /** CEFR levels this language ships content for */
  levels: CefrLevel[];
  /** Ordered curriculum (lessons) */
  curriculum: CurriculumLesson[];
  /** Master list of trackable grammar structures */
  structures: StructureDefinition[];
  /** Builds the system prompt for the Realtime voice tutor */
  buildTutorPrompt: (input: TutorPromptInput) => string;
}
