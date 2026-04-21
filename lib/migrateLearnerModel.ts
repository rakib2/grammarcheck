import { SupabaseClient } from "@supabase/supabase-js";
import { LearnerModel } from "@/types";

const STORAGE_KEY = "grammarcoach_learner_model";
const BACKUP_KEY = "grammarcoach_learner_model_backup";
const MIGRATED_KEY = "grammarcoach_migrated";

export interface MigrationResult {
  status: "success" | "skipped" | "error";
  reason: string;
  counts?: {
    structures: number;
    errorPatterns: number;
    srsItems: number;
  };
}

/**
 * Migrate localStorage LearnerModel to Supabase.
 *
 * Safety guarantees:
 *   1. Backup copy saved to localStorage before any writes
 *   2. All Supabase inserts happen, then verified by reading back
 *   3. Only marked "migrated" after verification passes
 *   4. On any failure: stops, keeps original, returns error — safe to retry
 *   5. Backup key is never deleted (permanent safety net)
 *   6. Idempotent: skips if already migrated or no data exists
 */
export async function migrateLearnerModelToSupabase(
  supabase: SupabaseClient,
  userId: string
): Promise<MigrationResult> {
  // Skip if already migrated
  if (typeof window === "undefined") {
    return { status: "skipped", reason: "Not in browser" };
  }

  if (localStorage.getItem(MIGRATED_KEY)) {
    return { status: "skipped", reason: "Already migrated" };
  }

  // Read source data
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { status: "skipped", reason: "No localStorage data found" };
  }

  let model: LearnerModel;
  try {
    model = JSON.parse(raw);
  } catch {
    return { status: "error", reason: "Failed to parse localStorage data" };
  }

  // Validate minimum data
  if (!model.nativeLanguage || !model.detectedLevel) {
    return { status: "skipped", reason: "localStorage data is empty/default" };
  }

  // Step 1: Save backup (permanent safety net)
  localStorage.setItem(BACKUP_KEY, raw);

  // Step 2: Check if user already has a learner model in Supabase
  const { data: existing } = await supabase
    .from("learner_models")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (existing) {
    // User already has server data — don't overwrite
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    return { status: "skipped", reason: "Learner model already exists in Supabase" };
  }

  // Step 3: Insert learner_models row
  const { data: inserted, error: insertErr } = await supabase
    .from("learner_models")
    .insert({
      user_id: userId,
      native_language: model.nativeLanguage,
      detected_level: model.detectedLevel,
      session_count: model.sessionCount,
      total_turns: model.totalTurns,
      created_at: model.createdAt || new Date().toISOString(),
      updated_at: model.updatedAt || new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return { status: "error", reason: `Failed to insert learner model: ${insertErr?.message}` };
  }

  const learnerId = inserted.id;

  // Step 4: Insert structure_mastery rows
  if (model.structures.length > 0) {
    const structureRows = model.structures.map((s) => ({
      learner_id: learnerId,
      structure_id: s.id,
      name: s.name,
      cefr_level: s.cefrLevel,
      mastery: s.mastery,
      attempts: s.attempts,
      last_seen: s.lastSeen || null,
      last_correct: s.lastCorrect ?? null,
    }));

    const { error: structErr } = await supabase
      .from("structure_mastery")
      .insert(structureRows);

    if (structErr) {
      // Rollback: delete the learner model (cascades to children)
      await supabase.from("learner_models").delete().eq("id", learnerId);
      return { status: "error", reason: `Failed to insert structures: ${structErr.message}` };
    }
  }

  // Step 5: Insert error_patterns rows
  if (model.errorPatterns.length > 0) {
    const errorRows = model.errorPatterns.map((e) => ({
      learner_id: learnerId,
      structure_id: e.structureId,
      pattern: e.pattern,
      example: e.example,
      correction: e.correction,
      count: e.count,
      correction_level: e.correctionLevel,
      last_seen: e.lastSeen || new Date().toISOString(),
    }));

    const { error: errorErr } = await supabase
      .from("error_patterns")
      .insert(errorRows);

    if (errorErr) {
      await supabase.from("learner_models").delete().eq("id", learnerId);
      return { status: "error", reason: `Failed to insert error patterns: ${errorErr.message}` };
    }
  }

  // Step 6: Insert srs_queue rows
  if (model.spacedRepetitionQueue.length > 0) {
    const srsRows = model.spacedRepetitionQueue.map((s) => ({
      learner_id: learnerId,
      structure_id: s.structureId,
      due_at: s.dueAt,
      interval: s.interval,
      ease_factor: s.easeFactor,
      repetitions: s.repetitions,
    }));

    const { error: srsErr } = await supabase
      .from("srs_queue")
      .insert(srsRows);

    if (srsErr) {
      await supabase.from("learner_models").delete().eq("id", learnerId);
      return { status: "error", reason: `Failed to insert SRS queue: ${srsErr.message}` };
    }
  }

  // Step 7: Verify — read back and check counts
  const [
    { count: structCount },
    { count: errorCount },
    { count: srsCount },
  ] = await Promise.all([
    supabase.from("structure_mastery").select("*", { count: "exact", head: true }).eq("learner_id", learnerId),
    supabase.from("error_patterns").select("*", { count: "exact", head: true }).eq("learner_id", learnerId),
    supabase.from("srs_queue").select("*", { count: "exact", head: true }).eq("learner_id", learnerId),
  ]);

  const expectedStructures = model.structures.length;
  const expectedErrors = model.errorPatterns.length;
  const expectedSrs = model.spacedRepetitionQueue.length;

  if (
    (structCount ?? 0) !== expectedStructures ||
    (errorCount ?? 0) !== expectedErrors ||
    (srsCount ?? 0) !== expectedSrs
  ) {
    // Verification failed — rollback
    await supabase.from("learner_models").delete().eq("id", learnerId);
    return {
      status: "error",
      reason: `Verification failed: expected ${expectedStructures}/${expectedErrors}/${expectedSrs} rows, got ${structCount}/${errorCount}/${srsCount}`,
    };
  }

  // Step 8: Mark as migrated (original + backup stay in localStorage forever)
  localStorage.setItem(MIGRATED_KEY, new Date().toISOString());

  return {
    status: "success",
    reason: "Migration complete and verified",
    counts: {
      structures: expectedStructures,
      errorPatterns: expectedErrors,
      srsItems: expectedSrs,
    },
  };
}

/**
 * Check if migration is needed (for UI display).
 */
export function needsMigration(): boolean {
  if (typeof window === "undefined") return false;
  if (localStorage.getItem(MIGRATED_KEY)) return false;
  return !!localStorage.getItem(STORAGE_KEY);
}

/**
 * Get the backup data if migration went wrong and manual recovery is needed.
 */
export function getBackupModel(): LearnerModel | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(BACKUP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
