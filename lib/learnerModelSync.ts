import { LearnerModel, GrammarStructure, ErrorPattern, SpacedRepetitionItem, CefrLevel } from "@/types";
import { supabase } from "./supabase";

const STORAGE_KEY = "grammarcoach_learner_model";

// ── localStorage helpers ──────────────────────────────────────────

function readLocal(): LearnerModel | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(model: LearnerModel): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Quota exceeded or serialization failed — non-fatal
  }
}

// ── Supabase row ↔ LearnerModel mapping ───────────────────────────

interface LearnerRow {
  id: string;
  native_language: string;
  coach_language: string | null;
  detected_level: CefrLevel;
  session_count: number;
  total_turns: number;
  created_at: string;
  updated_at: string;
}

interface StructureRow {
  structure_id: string;
  name: string;
  cefr_level: CefrLevel;
  mastery: number;
  attempts: number;
  last_seen: string | null;
  last_correct: boolean | null;
}

interface ErrorRow {
  id: string;
  structure_id: string;
  pattern: string;
  example: string | null;
  correction: string | null;
  count: number;
  correction_level: "recast" | "highlight" | "explicit";
  last_seen: string;
}

interface SrsRow {
  id: string;
  structure_id: string;
  due_at: string;
  interval: number;
  ease_factor: number;
  repetitions: number;
}

function rowsToModel(
  learner: LearnerRow,
  structures: StructureRow[],
  errors: ErrorRow[],
  srs: SrsRow[]
): LearnerModel {
  const grammarStructures: GrammarStructure[] = structures.map((s) => ({
    id: s.structure_id,
    name: s.name,
    cefrLevel: s.cefr_level,
    mastery: s.mastery,
    attempts: s.attempts,
    lastSeen: s.last_seen,
    lastCorrect: s.last_correct,
  }));

  const errorPatterns: ErrorPattern[] = errors.map((e) => ({
    id: e.id,
    structureId: e.structure_id,
    pattern: e.pattern,
    example: e.example ?? "",
    correction: e.correction ?? "",
    count: e.count,
    correctionLevel: e.correction_level,
    lastSeen: e.last_seen,
  }));

  const srsQueue: SpacedRepetitionItem[] = srs.map((s) => ({
    id: s.id,
    structureId: s.structure_id,
    dueAt: s.due_at,
    interval: s.interval,
    easeFactor: s.ease_factor,
    repetitions: s.repetitions,
  }));

  return {
    id: learner.id,
    nativeLanguage: learner.native_language,
    coachLanguage: learner.coach_language ?? learner.native_language,
    detectedLevel: learner.detected_level,
    structures: grammarStructures,
    errorPatterns,
    spacedRepetitionQueue: srsQueue,
    sessionCount: learner.session_count,
    totalTurns: learner.total_turns,
    createdAt: learner.created_at,
    updatedAt: learner.updated_at,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Load the learner model.
 *
 * If a userId is passed, Supabase is the source of truth — we fetch the
 * learner_models row + its children. When that succeeds we also mirror the
 * result to localStorage so future reads are fast and offline-tolerant.
 *
 * If no userId, or Supabase has no row for this user yet, we fall back to
 * localStorage (first-time users, or users on the localhost auth bypass).
 */
export async function loadLearnerModel(
  userId: string | null
): Promise<LearnerModel | null> {
  if (!userId) return readLocal();

  try {
    const { data: learner, error: learnerErr } = await supabase
      .from("learner_models")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (learnerErr) {
      console.warn("[learnerModelSync] load learner row failed:", learnerErr.message);
      return readLocal();
    }
    if (!learner) {
      // No server row yet — first-time cloud user. Use local cache if any.
      return readLocal();
    }

    const [
      { data: structures, error: sErr },
      { data: errors, error: eErr },
      { data: srs, error: rErr },
    ] = await Promise.all([
      supabase.from("structure_mastery").select("*").eq("learner_id", learner.id),
      supabase.from("error_patterns").select("*").eq("learner_id", learner.id),
      supabase.from("srs_queue").select("*").eq("learner_id", learner.id),
    ]);

    if (sErr || eErr || rErr) {
      console.warn(
        "[learnerModelSync] load children failed:",
        sErr?.message ?? eErr?.message ?? rErr?.message
      );
      return readLocal();
    }

    const model = rowsToModel(
      learner as LearnerRow,
      (structures ?? []) as StructureRow[],
      (errors ?? []) as ErrorRow[],
      (srs ?? []) as SrsRow[]
    );

    // Mirror to localStorage so quick refreshes don't need a round trip
    writeLocal(model);
    return model;
  } catch (err) {
    console.warn("[learnerModelSync] load threw:", err);
    return readLocal();
  }
}

/**
 * Persist the learner model.
 *
 * localStorage is written synchronously (fast, offline-tolerant).
 * Supabase is upserted fire-and-forget when userId is set — a failed write
 * is logged but never blocks the UI. The next successful write will overwrite.
 *
 * Strategy: wipe-and-reinsert the children (structure_mastery / error_patterns /
 * srs_queue). Simpler than diffing and safe because they're fully owned by this
 * one learner row, cascade on delete, and the in-memory model is the truth.
 */
export async function saveLearnerModel(
  model: LearnerModel,
  userId: string | null
): Promise<void> {
  // 1. Local cache — always, synchronously
  writeLocal(model);

  // 2. Server mirror — only if signed in
  if (!userId) return;

  try {
    // Upsert parent row by user_id. Capture its id for child references.
    const { data: upserted, error: upsertErr } = await supabase
      .from("learner_models")
      .upsert(
        {
          user_id: userId,
          native_language: model.nativeLanguage,
          coach_language: model.coachLanguage,
          detected_level: model.detectedLevel,
          session_count: model.sessionCount,
          total_turns: model.totalTurns,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("id")
      .single();

    if (upsertErr || !upserted) {
      console.warn("[learnerModelSync] upsert learner failed:", upsertErr?.message);
      return;
    }

    const learnerId = upserted.id as string;

    // Wipe children, then re-insert from the model.
    // Errors here are non-fatal — a partial save is still better than a drop.
    const [delS, delE, delR] = await Promise.all([
      supabase.from("structure_mastery").delete().eq("learner_id", learnerId),
      supabase.from("error_patterns").delete().eq("learner_id", learnerId),
      supabase.from("srs_queue").delete().eq("learner_id", learnerId),
    ]);
    if (delS.error) console.warn("[learnerModelSync] delete structures:", delS.error.message);
    if (delE.error) console.warn("[learnerModelSync] delete errors:", delE.error.message);
    if (delR.error) console.warn("[learnerModelSync] delete srs:", delR.error.message);

    if (model.structures.length > 0) {
      const { error } = await supabase.from("structure_mastery").insert(
        model.structures.map((s) => ({
          learner_id: learnerId,
          structure_id: s.id,
          name: s.name,
          cefr_level: s.cefrLevel,
          mastery: s.mastery,
          attempts: s.attempts,
          last_seen: s.lastSeen,
          last_correct: s.lastCorrect,
        }))
      );
      if (error) console.warn("[learnerModelSync] insert structures:", error.message);
    }

    if (model.errorPatterns.length > 0) {
      const { error } = await supabase.from("error_patterns").insert(
        model.errorPatterns.map((e) => ({
          learner_id: learnerId,
          structure_id: e.structureId,
          pattern: e.pattern,
          example: e.example,
          correction: e.correction,
          count: e.count,
          correction_level: e.correctionLevel,
          last_seen: e.lastSeen,
        }))
      );
      if (error) console.warn("[learnerModelSync] insert errors:", error.message);
    }

    if (model.spacedRepetitionQueue.length > 0) {
      const { error } = await supabase.from("srs_queue").insert(
        model.spacedRepetitionQueue.map((s) => ({
          learner_id: learnerId,
          structure_id: s.structureId,
          due_at: s.dueAt,
          interval: s.interval,
          ease_factor: s.easeFactor,
          repetitions: s.repetitions,
        }))
      );
      if (error) console.warn("[learnerModelSync] insert srs:", error.message);
    }
  } catch (err) {
    console.warn("[learnerModelSync] save threw:", err);
  }
}

/** Synchronous local-only read. Useful for pre-auth renders or migrations. */
export function loadLearnerModelLocal(): LearnerModel | null {
  return readLocal();
}

/** Synchronous local-only write. Use when you need to bypass the async Supabase leg. */
export function saveLearnerModelLocal(model: LearnerModel): void {
  writeLocal(model);
}
