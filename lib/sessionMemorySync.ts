import { CefrLevel } from "@/types";
import { supabase } from "./supabase";
import {
  loadSnapshots as loadSnapshotsLocal,
  loadSummaries as loadSummariesLocal,
  MasterySnapshot,
  SessionSummary,
} from "./sessionMemory";

/**
 * Session history sync — Supabase as source of truth for the per-session
 * snapshot + summary records that previously lived only in localStorage.
 *
 * Mirrors the pattern in {@link ./learnerModelSync.ts} and
 * {@link ./vocabularySync.ts}. Tables are `mastery_snapshots` and
 * `session_summaries` — see supabase/schema-session-history.sql.
 *
 * Local cache stays as the offline fallback and as the synchronous read
 * path for code that doesn't have a userId in scope.
 */

// ── Snapshots ────────────────────────────────────────────

interface SnapshotRow {
  id: string;
  user_id: string;
  session_number: number;
  recorded_at: string;
  detected_level: CefrLevel;
  total_turns: number;
  structures: MasterySnapshot["structures"];
  error_counts: MasterySnapshot["errorCounts"];
  avg_mastery: number;
  total_errors: number;
  structures_discovered: number;
  structures_mastered: number;
}

function rowToSnapshot(row: SnapshotRow): MasterySnapshot {
  return {
    sessionNumber: row.session_number,
    timestamp: row.recorded_at,
    detectedLevel: row.detected_level,
    totalTurns: row.total_turns,
    structures: row.structures ?? [],
    errorCounts: row.error_counts ?? [],
    stats: {
      avgMastery: row.avg_mastery,
      totalErrors: row.total_errors,
      structuresDiscovered: row.structures_discovered,
      structuresMastered: row.structures_mastered,
    },
  };
}

function snapshotToRow(s: MasterySnapshot, userId: string): Omit<SnapshotRow, "id"> {
  return {
    user_id: userId,
    session_number: s.sessionNumber,
    recorded_at: s.timestamp,
    detected_level: s.detectedLevel,
    total_turns: s.totalTurns,
    structures: s.structures,
    error_counts: s.errorCounts,
    avg_mastery: s.stats.avgMastery,
    total_errors: s.stats.totalErrors,
    structures_discovered: s.stats.structuresDiscovered,
    structures_mastered: s.stats.structuresMastered,
  };
}

/**
 * Load all snapshots for a user. Server-of-truth when signed in,
 * localStorage fallback otherwise. Mirrors result back to localStorage
 * so synchronous consumers (ActivityCard etc.) see fresh data on next render.
 */
export async function loadSnapshots(userId: string | null): Promise<MasterySnapshot[]> {
  if (!userId) return loadSnapshotsLocal();

  try {
    const { data, error } = await supabase
      .from("mastery_snapshots")
      .select("*")
      .eq("user_id", userId)
      .order("session_number", { ascending: true });

    if (error) {
      console.warn("[sessionMemorySync] load snapshots failed:", error.message);
      return loadSnapshotsLocal();
    }

    const snaps = ((data ?? []) as SnapshotRow[]).map(rowToSnapshot);
    if (typeof window !== "undefined") {
      localStorage.setItem("grammarcoach_mastery_snapshots", JSON.stringify(snaps));
    }
    return snaps;
  } catch (err) {
    console.warn("[sessionMemorySync] load snapshots threw:", err);
    return loadSnapshotsLocal();
  }
}

/**
 * Persist a freshly-taken snapshot. localStorage is updated immediately
 * (the existing sessionMemory.takeSnapshot already does this); this layer
 * mirrors the row to Supabase fire-and-forget.
 */
export async function saveSnapshot(
  snapshot: MasterySnapshot,
  userId: string | null
): Promise<void> {
  if (!userId) return;
  try {
    const row = snapshotToRow(snapshot, userId);
    const { error } = await supabase
      .from("mastery_snapshots")
      .upsert(row, { onConflict: "user_id,session_number" });
    if (error) console.warn("[sessionMemorySync] save snapshot failed:", error.message);
  } catch (err) {
    console.warn("[sessionMemorySync] save snapshot threw:", err);
  }
}

// ── Summaries ────────────────────────────────────────────

interface SummaryRow {
  id: string;
  user_id: string;
  session_number: number;
  recorded_at: string;
  turn_count: number;
  structures_practiced: string[];
  errors_this_session: number;
  mastery_deltas: SessionSummary["masteryDeltas"];
  summary_text: string;
  top_strength: string | null;
  top_weakness: string | null;
}

function rowToSummary(row: SummaryRow): SessionSummary {
  return {
    sessionNumber: row.session_number,
    timestamp: row.recorded_at,
    turnCount: row.turn_count,
    structuresPracticed: row.structures_practiced ?? [],
    errorsThisSession: row.errors_this_session,
    masteryDeltas: row.mastery_deltas ?? [],
    summaryText: row.summary_text,
    topStrength: row.top_strength,
    topWeakness: row.top_weakness,
  };
}

function summaryToRow(s: SessionSummary, userId: string): Omit<SummaryRow, "id"> {
  return {
    user_id: userId,
    session_number: s.sessionNumber,
    recorded_at: s.timestamp,
    turn_count: s.turnCount,
    structures_practiced: s.structuresPracticed,
    errors_this_session: s.errorsThisSession,
    mastery_deltas: s.masteryDeltas,
    summary_text: s.summaryText,
    top_strength: s.topStrength,
    top_weakness: s.topWeakness,
  };
}

export async function loadSummaries(userId: string | null): Promise<SessionSummary[]> {
  if (!userId) return loadSummariesLocal();

  try {
    const { data, error } = await supabase
      .from("session_summaries")
      .select("*")
      .eq("user_id", userId)
      .order("session_number", { ascending: true });

    if (error) {
      console.warn("[sessionMemorySync] load summaries failed:", error.message);
      return loadSummariesLocal();
    }

    const sums = ((data ?? []) as SummaryRow[]).map(rowToSummary);
    if (typeof window !== "undefined") {
      localStorage.setItem("grammarcoach_session_summaries", JSON.stringify(sums));
    }
    return sums;
  } catch (err) {
    console.warn("[sessionMemorySync] load summaries threw:", err);
    return loadSummariesLocal();
  }
}

export async function saveSummary(
  summary: SessionSummary,
  userId: string | null
): Promise<void> {
  if (!userId) return;
  try {
    const row = summaryToRow(summary, userId);
    const { error } = await supabase
      .from("session_summaries")
      .upsert(row, { onConflict: "user_id,session_number" });
    if (error) console.warn("[sessionMemorySync] save summary failed:", error.message);
  } catch (err) {
    console.warn("[sessionMemorySync] save summary threw:", err);
  }
}
