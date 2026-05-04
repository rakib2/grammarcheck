import type { LanguageConfig } from "./types";
import { GERMAN } from "./de";

/**
 * Language registry.
 *
 * Adding a new target language:
 *   1. Create `lib/languages/<code>.ts` exporting a `LanguageConfig`.
 *   2. Import it here and add an entry to `LANGUAGES`.
 *
 * Everything else in the app — curriculum loading, tutor prompts, structure
 * lists — flows through `getLanguageConfig(code)` so the surface stays the
 * same regardless of which language is active.
 */

export const DEFAULT_LANGUAGE_ID = "de";

export const LANGUAGES: Record<string, LanguageConfig> = {
  [GERMAN.id]: GERMAN,
};

export function getLanguageConfig(code: string | null | undefined): LanguageConfig {
  if (code && LANGUAGES[code]) return LANGUAGES[code];
  return LANGUAGES[DEFAULT_LANGUAGE_ID];
}

export function listLanguages(): LanguageConfig[] {
  return Object.values(LANGUAGES);
}

export type { LanguageConfig, TutorPromptInput } from "./types";
