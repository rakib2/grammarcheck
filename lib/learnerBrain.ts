import { LearnerModel } from "@/types";
import { getStructureForLesson, getRecommendedLessons } from "./learningPath";
import { getLessonById } from "./curriculum";

/**
 * Learner "brain" — pure functions that turn the persisted learner state
 * into actionable hints. No I/O, no React, no Supabase. The pool API
 * accepts the hints and shapes Claude's prompt; the LessonComplete card
 * uses the recommendation to surface a "or focus on" alternative path.
 *
 * Two entry points:
 *   - {@link computeAdaptationHints}  — per-lesson difficulty/mode mix
 *   - {@link recommendNextLesson}     — cross-lesson "or try this" suggestion
 */

// ── Per-lesson adaptation ──

export type DifficultyBand = "easy" | "balanced" | "hard";

export interface AdaptationHints {
  /** Mastery bucket for the lesson's structure today, or null if unseen. */
  mastery: number | null;
  /**
   * Aggregated score of the learner's last N pool submissions for this topic.
   * `null` when no prior submissions exist (cold start).
   */
  recentAverageScore: number | null;
  recentSubmissionCount: number;
  /** Difficulty target the generator should aim for. */
  difficulty: DifficultyBand;
  /**
   * Suggested mix of drill modes (sums to ~1). The generator can hand this
   * to Claude as a soft constraint; Claude's tagging already handles eval
   * strategy, this just biases which modes are *generated*.
   */
  modeMix: {
    recognize: number;
    complete: number;
    transform: number;
    produce: number;
    recall: number;
  };
  /**
   * Other structures that depend on or share material with this lesson and
   * are themselves weak — fair game for sneak-in review inside drills.
   */
  dependentWeakStructures: { id: string; name: string; mastery: number }[];
}

const BALANCED_MIX = {
  recognize: 0.15,
  complete: 0.3,
  transform: 0.2,
  produce: 0.25,
  recall: 0.1,
};

const EASY_MIX = {
  recognize: 0.3,
  complete: 0.4,
  transform: 0.2,
  produce: 0.1,
  recall: 0,
};

const HARD_MIX = {
  recognize: 0,
  complete: 0.15,
  transform: 0.25,
  produce: 0.4,
  recall: 0.2,
};

/**
 * Decide the difficulty band from mastery + recent scores. The recent score
 * trumps long-running mastery — if the learner just bombed three drills,
 * easing up is the right call regardless of their historical mastery.
 */
function pickDifficulty(
  mastery: number | null,
  recentAvg: number | null
): DifficultyBand {
  if (recentAvg !== null) {
    if (recentAvg < 0.4) return "easy";
    if (recentAvg > 0.85) return "hard";
  }
  if (mastery === null) return "balanced";
  if (mastery < 0.4) return "easy";
  if (mastery > 0.7) return "hard";
  return "balanced";
}

/**
 * Find structures whose mastery is < 0.5 AND share a CEFR level with the
 * current lesson — fair candidates for light review inside this batch.
 * Caps at 3 so the prompt stays focused.
 */
function pickDependentWeakStructures(
  model: LearnerModel,
  currentStructureId: string | null
): { id: string; name: string; mastery: number }[] {
  if (!currentStructureId) return [];
  const current = model.structures.find((s) => s.id === currentStructureId);
  if (!current) return [];

  return model.structures
    .filter(
      (s) =>
        s.id !== currentStructureId &&
        s.cefrLevel === current.cefrLevel &&
        s.mastery < 0.5 &&
        s.attempts > 0
    )
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3)
    .map((s) => ({ id: s.id, name: s.name, mastery: s.mastery }));
}

export function computeAdaptationHints(
  model: LearnerModel | null,
  lessonId: string,
  recentScores: number[]
): AdaptationHints {
  const structureId = getStructureForLesson(lessonId);
  const structure =
    structureId && model
      ? model.structures.find((s) => s.id === structureId) ?? null
      : null;
  const mastery = structure ? structure.mastery : null;

  const recentAvg =
    recentScores.length > 0
      ? recentScores.reduce((a, b) => a + b, 0) / recentScores.length
      : null;

  const difficulty = pickDifficulty(mastery, recentAvg);
  const modeMix =
    difficulty === "easy"
      ? EASY_MIX
      : difficulty === "hard"
      ? HARD_MIX
      : BALANCED_MIX;

  return {
    mastery,
    recentAverageScore: recentAvg,
    recentSubmissionCount: recentScores.length,
    difficulty,
    modeMix,
    dependentWeakStructures: model
      ? pickDependentWeakStructures(model, structureId)
      : [],
  };
}

// ── Cross-lesson recommendation ──

export interface NextLessonSuggestion {
  /** The "regular" next lesson — the immediate one in CEFR order. */
  immediate: { lessonId: string; title: string } | null;
  /** Brain-picked alternative based on weak-structure urgency. Null if no
   *  weak structure exists or all weak structures point at the same lesson
   *  as `immediate`. */
  focusedAlternative: {
    lessonId: string;
    title: string;
    structureName: string;
    mastery: number;
    reason: string;
  } | null;
}

/**
 * Compute the post-lesson "where to go next" pair: the regular next lesson
 * (already returned by getNextLesson, supplied by the caller) + an optional
 * focused-practice alternative the brain picks from learningPath urgency.
 *
 * The alternative only shows up when:
 *   - There's a weak structure (mastery < 0.5) with attempts > 0
 *   - It maps to a different lesson than `immediateNextLessonId`
 *   - It isn't the lesson the learner just finished
 */
export function recommendNextLesson(
  model: LearnerModel | null,
  currentLessonId: string,
  immediateNextLessonId: string | null
): NextLessonSuggestion {
  const immediate = immediateNextLessonId
    ? (() => {
        const l = getLessonById(immediateNextLessonId);
        return l ? { lessonId: l.id, title: l.title } : null;
      })()
    : null;

  if (!model) return { immediate, focusedAlternative: null };

  const candidates = getRecommendedLessons(model, 5);
  const alt = candidates.find(
    (c) =>
      c.lessonId !== null &&
      c.lessonId !== currentLessonId &&
      c.lessonId !== immediateNextLessonId &&
      c.status !== "solid"
  );

  if (!alt || !alt.lessonId) return { immediate, focusedAlternative: null };

  const altLesson = getLessonById(alt.lessonId);
  if (!altLesson) return { immediate, focusedAlternative: null };

  const masteryPct = Math.round(alt.mastery * 100);
  const reason =
    alt.errorCount > 0
      ? `${alt.errorCount} recent error${alt.errorCount === 1 ? "" : "s"} on this rule`
      : `${masteryPct}% mastery — ready for another pass`;

  return {
    immediate,
    focusedAlternative: {
      lessonId: alt.lessonId,
      title: altLesson.title,
      structureName: alt.structureName,
      mastery: alt.mastery,
      reason,
    },
  };
}
