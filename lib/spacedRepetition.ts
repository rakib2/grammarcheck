import { SpacedRepetitionItem } from "@/types";

/**
 * SM-2 inspired spaced repetition algorithm adapted for conversation turns.
 *
 * Instead of days, we use "turns" as the interval unit because:
 * - Sessions are short (3-10 turns)
 * - We want to re-test within a session AND across sessions
 * - Intervals: 1 turn, 3 turns, 8 turns, 20 turns, 50 turns...
 *
 * Based on: Ebbinghaus spacing + Pimsleur graduated intervals + SM-2 ease factor
 */

const MIN_EASE = 1.3;
const INITIAL_EASE = 2.5;
const INITIAL_INTERVAL = 1; // re-test after 1 turn

/**
 * Create a new SRS item when an error is first detected
 */
export function createSRSItem(structureId: string): SpacedRepetitionItem {
  return {
    id: `srs_${structureId}_${Date.now()}`,
    structureId,
    dueAt: new Date().toISOString(), // due immediately
    interval: INITIAL_INTERVAL,
    easeFactor: INITIAL_EASE,
    repetitions: 0,
  };
}

/**
 * Update an SRS item based on performance.
 *
 * quality: 0-5 (SM-2 scale)
 *   0 = complete failure (same error repeated)
 *   1 = wrong but remembered after seeing correction
 *   2 = wrong but close
 *   3 = correct with effort
 *   4 = correct easily
 *   5 = perfect, used naturally
 */
export function updateSRSItem(
  item: SpacedRepetitionItem,
  quality: number,
  currentTurn: number
): SpacedRepetitionItem {
  const q = Math.max(0, Math.min(5, quality));

  if (q < 3) {
    // Failed — reset interval, keep ease
    return {
      ...item,
      interval: INITIAL_INTERVAL,
      repetitions: 0,
      dueAt: computeDueAt(currentTurn, INITIAL_INTERVAL),
    };
  }

  // Passed — increase interval
  let newInterval: number;
  if (item.repetitions === 0) {
    newInterval = 1;
  } else if (item.repetitions === 1) {
    newInterval = 3;
  } else {
    newInterval = Math.round(item.interval * item.easeFactor);
  }

  // Update ease factor (SM-2 formula)
  const newEase = Math.max(
    MIN_EASE,
    item.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  return {
    ...item,
    interval: newInterval,
    easeFactor: newEase,
    repetitions: item.repetitions + 1,
    dueAt: computeDueAt(currentTurn, newInterval),
  };
}

/**
 * Get items that are due for review
 */
export function getDueItems(
  queue: SpacedRepetitionItem[],
  currentTurn: number
): SpacedRepetitionItem[] {
  return queue
    .filter((item) => {
      // Parse the turn number from dueAt, or treat as due if it's a date
      const dueNum = parseDueTurn(item.dueAt);
      return dueNum <= currentTurn;
    })
    .sort((a, b) => a.interval - b.interval); // shortest interval first (most urgent)
}

/**
 * Convert quality assessment from error analysis to SM-2 quality score
 */
export function assessQuality(
  wasCorrect: boolean,
  correctionLevel: "recast" | "highlight" | "explicit",
  usedNaturally: boolean
): number {
  if (!wasCorrect) {
    if (correctionLevel === "explicit") return 0;
    if (correctionLevel === "highlight") return 1;
    return 2;
  }
  if (usedNaturally) return 5;
  if (correctionLevel === "recast") return 4; // got it right with subtle correction
  return 3;
}

function computeDueAt(currentTurn: number, interval: number): string {
  // Store as turn number in ISO-like format for compatibility
  return `turn:${currentTurn + interval}`;
}

function parseDueTurn(dueAt: string): number {
  if (dueAt.startsWith("turn:")) {
    return parseInt(dueAt.slice(5), 10);
  }
  // Legacy: if it's a real date, treat as due now
  return 0;
}
