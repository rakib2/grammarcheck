import type {
  ErrorPattern,
  GrammarAnalysis,
  CurriculumLesson,
  LessonPhase,
  PooledExercise,
} from "@/types";
import type {
  FocusedSessionPlan,
  FocusedTranslatePrompt,
} from "@/lib/lessonEngine";

/**
 * Lesson chat persistence — keeps an in-flight focused lesson alive across
 * page refreshes. Same shape as {@link ./sessionChatCache.ts} but carries the
 * extra phase-machine state the dashboard `/chat?lesson=…` flow uses.
 *
 * Cache is keyed by `(userId, sessionAttemptKey)`. A new attempt (retry,
 * different lesson) gets its own slot, so refreshing the page in the middle
 * of attempt N never restores stale state from attempt N-1. The slot is
 * cleared when the lesson reaches the `review` phase.
 *
 * Long-term durability lives in the learner model + score sync (already
 * Supabase-backed). This cache is hot-tier only — single-device, 24h TTL.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = "gf:lessonChat:";
const ANON_KEY = "anon";

type Message =
  | { role: "coach"; type: "text"; text: string }
  | { role: "coach"; type: "analysis"; text: string; analysis: GrammarAnalysis }
  | {
      role: "coach";
      type: "complete";
      lesson: CurriculumLesson;
      drillScore: number;
      writeScore: number;
      passed: boolean;
      nextLesson?: CurriculumLesson;
    }
  | { role: "user"; type: "text"; text: string };

export interface LessonChatSnapshot {
  schemaVersion: 3;
  savedAt: number;

  phase: LessonPhase;
  messages: Message[];

  drillIndex: number;
  drillResults: { correct: boolean }[];
  drillCorrectStreak: number;
  drillScore: number | null;

  translatePrompts: FocusedTranslatePrompt[] | null;
  translateIdx: number;
  translateAttempts: number;
  translateResults: { score: number; correct: boolean }[];
  translateScore: number | null;
  translatePromptShown: boolean;

  errorSpotMaterial: ErrorPattern | null;
  errorSpotScore: number | null;

  storyScore: number | null;
  writeScore: number | null;

  teachSent: boolean;

  sessionPlan: FocusedSessionPlan | null;
  pooledItems: PooledExercise[];
}

function storageKey(userId: string | null, attemptKey: string): string {
  return `${KEY_PREFIX}${userId ?? ANON_KEY}:${attemptKey}`;
}

export function loadLessonChat(
  userId: string | null,
  attemptKey: string
): LessonChatSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId, attemptKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LessonChatSnapshot;
    if (parsed.schemaVersion !== 3) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      window.localStorage.removeItem(storageKey(userId, attemptKey));
      return null;
    }
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLessonChat(
  userId: string | null,
  attemptKey: string,
  snapshot: Omit<LessonChatSnapshot, "schemaVersion" | "savedAt">
): void {
  if (typeof window === "undefined") return;
  // Don't bother caching empty / pre-init state — `messages` is the cheap signal.
  if (snapshot.messages.length === 0) {
    window.localStorage.removeItem(storageKey(userId, attemptKey));
    return;
  }
  try {
    const payload: LessonChatSnapshot = {
      ...snapshot,
      schemaVersion: 3,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId, attemptKey), JSON.stringify(payload));
  } catch {
    // Quota exceeded — drop silently. Score sync to Supabase is already in
    // flight whenever a phase actually completes; that's the durable state.
  }
}

export function clearLessonChat(userId: string | null, attemptKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId, attemptKey));
  } catch {}
}
