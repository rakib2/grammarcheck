import { VocabularyItem, VocabularyGrade } from "@/types";

/**
 * Vocabulary deck — local-first storage + SM-2-style spaced repetition.
 *
 * The deck lives in `localStorage["grammarcoach_vocabulary"]`, mirrored from
 * /api/vocabulary/propose proposals. Every grading runs through {@link gradeVocabulary}
 * which updates `interval`, `easeFactor`, `dueAt`, and the repetition counters
 * on a single item; the caller persists the resulting deck via {@link saveVocabulary}.
 */

const STORAGE_KEY = "grammarcoach_vocabulary";

export function loadVocabulary(): VocabularyItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VocabularyItem[]) : [];
  } catch {
    return [];
  }
}

export function saveVocabulary(items: VocabularyItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded — non-fatal
  }
}

/** Return items whose dueAt is in the past (or now). */
export function getDueVocabulary(items: VocabularyItem[], now: Date = new Date()): VocabularyItem[] {
  const t = now.getTime();
  return items.filter((it) => new Date(it.dueAt).getTime() <= t);
}

/** Items added but never graded — show in a separate "new" track. */
export function getNewVocabulary(items: VocabularyItem[]): VocabularyItem[] {
  return items.filter((it) => it.repetitions === 0 && it.lapses === 0);
}

/** Items not yet due — useful for activity / preview. */
export function getUpcomingVocabulary(items: VocabularyItem[], now: Date = new Date()): VocabularyItem[] {
  const t = now.getTime();
  return items.filter((it) => new Date(it.dueAt).getTime() > t);
}

/**
 * Apply a grade to a vocabulary item and return the updated item.
 *
 * Borrows the SM-2 schedule with a few tweaks for hand-feel:
 *   • "again" — reset to 1 day, reduce ease, count a lapse
 *   • "hard"  — interval × 1.2, slight ease drop
 *   • "good"  — interval × ease, ease unchanged
 *   • "easy"  — interval × ease × 1.3, slight ease bump
 *
 * First successful review (repetitions === 0 + grade !== again) snaps to 1 day,
 * second to 3 days; after that the multiplier kicks in. This matches Anki defaults.
 */
export function gradeVocabulary(
  item: VocabularyItem,
  grade: VocabularyGrade,
  now: Date = new Date()
): VocabularyItem {
  const next: VocabularyItem = { ...item };
  const nowIso = now.toISOString();

  // Ease adjustments (clamped to a sensible band)
  const easeDelta: Record<VocabularyGrade, number> = {
    again: -0.2,
    hard: -0.15,
    good: 0,
    easy: 0.15,
  };
  next.easeFactor = clamp(item.easeFactor + easeDelta[grade], 1.3, 2.8);

  if (grade === "again") {
    next.interval = 1;
    next.repetitions = 0;
    next.lapses = item.lapses + 1;
  } else {
    const reps = item.repetitions + 1;
    let interval: number;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else {
      const multiplier = grade === "hard" ? 1.2 : grade === "easy" ? next.easeFactor * 1.3 : next.easeFactor;
      interval = Math.max(1, Math.round(item.interval * multiplier));
    }
    next.interval = interval;
    next.repetitions = reps;
  }

  next.lastReviewed = nowIso;
  next.dueAt = new Date(now.getTime() + next.interval * 86_400_000).toISOString();
  return next;
}

/**
 * Add freshly proposed items to the deck (idempotent on lemma).
 * New items default to dueAt=today so they show up in the daily deck immediately.
 */
export function upsertVocabulary(
  existing: VocabularyItem[],
  fresh: VocabularyItem[]
): VocabularyItem[] {
  const byLemma = new Map(existing.map((it) => [it.lemma.toLowerCase(), it] as const));
  for (const item of fresh) {
    if (!byLemma.has(item.lemma.toLowerCase())) {
      byLemma.set(item.lemma.toLowerCase(), item);
    }
  }
  return Array.from(byLemma.values());
}

/**
 * Build a fresh VocabularyItem from a proposal payload (no SRS state attached).
 * Defaults the schedule to "due today, never reviewed."
 */
export function newVocabularyItem(seed: {
  lemma: string;
  partOfSpeech: VocabularyItem["partOfSpeech"];
  cefrLevel: VocabularyItem["cefrLevel"];
  exampleSentence: string;
  l1Translation: string;
  inflection?: string;
  gender?: VocabularyItem["gender"];
  plural?: string;
  structureId?: string;
}): VocabularyItem {
  const now = new Date().toISOString();
  return {
    id: `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    introduced: now,
    lastReviewed: null,
    dueAt: now,
    interval: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    ...seed,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
