import { PooledExercise, PooledExerciseKind } from "@/types";
import { supabase } from "./supabase";
import {
  mergeIntoSlice,
  patchItem,
  readSlice,
  writeSlice,
} from "./exercisePool";

/**
 * Exercise pool sync — Supabase as source of truth, localStorage as cache.
 *
 * Same dual-tier shape as lib/vocabularySync.ts:
 *   • signed-in users: server-backed, mirrored to localStorage
 *   • signed-out / offline / failure: localStorage fallback
 *
 * The pool table (supabase/schema-exercise-pool.sql) is RLS-locked to the
 * owning user. All mutating ops here are user-scoped.
 */

interface PoolRow {
  id: string;
  user_id: string;
  language: string;
  topic_id: string;
  kind: PooledExerciseKind;
  payload: Record<string, unknown>;
  payload_hash: string;
  eval_kind: PooledExercise["evalKind"];
  eval_spec: Record<string, unknown>;
  status: PooledExercise["status"];
  batch_id: string;
  generated_at: string;
  served_at: string | null;
  submitted_at: string | null;
  score: number | null;
}

function rowToItem(row: PoolRow): PooledExercise {
  return {
    id: row.id,
    language: row.language,
    topicId: row.topic_id,
    kind: row.kind,
    payload: row.payload,
    payloadHash: row.payload_hash,
    evalKind: row.eval_kind,
    evalSpec: row.eval_spec,
    status: row.status,
    batchId: row.batch_id,
    generatedAt: row.generated_at,
    servedAt: row.served_at,
    submittedAt: row.submitted_at,
    score: row.score,
  };
}

/**
 * Load the next slice of pending+served exercises for a user/topic/kind.
 * Returns up to `limit` rows, oldest-generated first (FIFO consumption).
 *
 * On Supabase failure or signed-out, falls back to the localStorage cache.
 */
export async function loadPoolSlice(
  userId: string | null,
  topicId: string,
  kind: PooledExerciseKind,
  limit = 8
): Promise<PooledExercise[]> {
  if (!userId) {
    return readSlice(topicId, kind)
      .filter((e) => e.status === "pending" || e.status === "served")
      .slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from("exercise_pool")
      .select("*")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("kind", kind)
      .in("status", ["pending", "served"])
      .order("generated_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.warn("[exercisePoolSync] load failed:", error.message);
      return readSlice(topicId, kind)
        .filter((e) => e.status === "pending" || e.status === "served")
        .slice(0, limit);
    }

    const items = ((data ?? []) as PoolRow[]).map(rowToItem);
    writeSlice(topicId, kind, items); // mirror for next quick refresh
    return items;
  } catch (err) {
    console.warn("[exercisePoolSync] load threw:", err);
    return readSlice(topicId, kind)
      .filter((e) => e.status === "pending" || e.status === "served")
      .slice(0, limit);
  }
}

/**
 * Count remaining pending exercises so the client can decide whether to
 * fire a refill. Cheap because of the partial index on (user_id, topic_id,
 * status, generated_at).
 */
export async function countPending(
  userId: string | null,
  topicId: string,
  kind: PooledExerciseKind
): Promise<number> {
  if (!userId) {
    return readSlice(topicId, kind).filter((e) => e.status === "pending").length;
  }

  try {
    const { count, error } = await supabase
      .from("exercise_pool")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("kind", kind)
      .eq("status", "pending");

    if (error) {
      console.warn("[exercisePoolSync] count failed:", error.message);
      return readSlice(topicId, kind).filter((e) => e.status === "pending").length;
    }
    return count ?? 0;
  } catch (err) {
    console.warn("[exercisePoolSync] count threw:", err);
    return readSlice(topicId, kind).filter((e) => e.status === "pending").length;
  }
}

/**
 * Pull the most recent N payload hashes for a user/topic — the generator
 * passes these to Claude as a "do not repeat" list to keep batches fresh.
 */
export async function recentHashes(
  userId: string | null,
  topicId: string,
  kind: PooledExerciseKind,
  limit = 50
): Promise<string[]> {
  if (!userId) {
    return readSlice(topicId, kind).map((e) => e.payloadHash).slice(0, limit);
  }

  try {
    const { data, error } = await supabase
      .from("exercise_pool")
      .select("payload_hash")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("kind", kind)
      .order("generated_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[exercisePoolSync] recentHashes failed:", error.message);
      return [];
    }
    return (data ?? []).map((r) => r.payload_hash as string);
  } catch (err) {
    console.warn("[exercisePoolSync] recentHashes threw:", err);
    return [];
  }
}

/**
 * Pull the most recent submitted scores for a user/topic. Used by the
 * brain layer to decide whether to make the next batch easier/harder.
 *
 * Returns scores normalized to 0..1 (the score column is stored that way).
 * Limit defaults to 20 — enough signal to detect a streak without dragging
 * in ancient performance.
 */
export async function recentSubmissions(
  userId: string | null,
  topicId: string,
  limit = 20
): Promise<number[]> {
  if (!userId) {
    return readSlice(topicId, "drill")
      .filter((e) => e.status === "submitted" && typeof e.score === "number")
      .slice(0, limit)
      .map((e) => e.score as number);
  }

  try {
    const { data, error } = await supabase
      .from("exercise_pool")
      .select("score")
      .eq("user_id", userId)
      .eq("topic_id", topicId)
      .eq("status", "submitted")
      .not("score", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[exercisePoolSync] recentSubmissions failed:", error.message);
      return [];
    }
    return (data ?? [])
      .map((r) => (typeof r.score === "number" ? r.score : null))
      .filter((s): s is number => s !== null);
  } catch (err) {
    console.warn("[exercisePoolSync] recentSubmissions threw:", err);
    return [];
  }
}

/**
 * Mark an exercise as served (rendered to the user). Optimistic local
 * write + async Supabase update; failures are non-fatal.
 */
export async function markServed(
  userId: string | null,
  itemId: string,
  topicId: string,
  kind: PooledExerciseKind
): Promise<void> {
  const nowIso = new Date().toISOString();
  patchItem(topicId, kind, itemId, { status: "served", servedAt: nowIso });

  if (!userId) return;
  try {
    const { error } = await supabase
      .from("exercise_pool")
      .update({ status: "served", served_at: nowIso })
      .eq("user_id", userId)
      .eq("id", itemId);
    if (error) console.warn("[exercisePoolSync] markServed failed:", error.message);
  } catch (err) {
    console.warn("[exercisePoolSync] markServed threw:", err);
  }
}

/**
 * Mark an exercise as submitted with a score. Same optimistic-local +
 * background-Supabase pattern.
 */
export async function markSubmitted(
  userId: string | null,
  itemId: string,
  topicId: string,
  kind: PooledExerciseKind,
  score: number
): Promise<void> {
  const nowIso = new Date().toISOString();
  patchItem(topicId, kind, itemId, {
    status: "submitted",
    submittedAt: nowIso,
    score,
  });

  if (!userId) return;
  try {
    const { error } = await supabase
      .from("exercise_pool")
      .update({ status: "submitted", submitted_at: nowIso, score })
      .eq("user_id", userId)
      .eq("id", itemId);
    if (error) console.warn("[exercisePoolSync] markSubmitted failed:", error.message);
  } catch (err) {
    console.warn("[exercisePoolSync] markSubmitted threw:", err);
  }
}

/**
 * Insert a freshly-generated batch from the API route. Server-side caller
 * (the API route) writes directly to Supabase using a service role; this
 * helper is for client-initiated inserts after a fire-and-forget refill
 * call returns the batch payload.
 *
 * Idempotent: if rows for this batch_id already exist server-side
 * (because the API route wrote them too), the upsert is a no-op.
 */
export async function ingestBatch(
  userId: string | null,
  topicId: string,
  _kind: PooledExerciseKind,
  batch: PooledExercise[]
): Promise<PooledExercise[]> {
  // The batch can mix kinds (drill + translate + story + error_spot). The
  // localStorage cache is keyed by `${topicId}:${kind}`, so we must split
  // the batch by each item's actual `kind` and merge into the right slice.
  // Otherwise a translate item would be filed under the drill cache and be
  // invisible to `loadPoolSlice(..., "translate")` for offline/signed-out users.
  const byKind = new Map<PooledExerciseKind, PooledExercise[]>();
  for (const item of batch) {
    const list = byKind.get(item.kind) ?? [];
    list.push(item);
    byKind.set(item.kind, list);
  }
  const merged: PooledExercise[] = [];
  byKind.forEach((items, kind) => {
    merged.push(...mergeIntoSlice(topicId, kind, items));
  });

  if (!userId || batch.length === 0) return merged;

  try {
    const rows = batch.map((it) => ({
      id: it.id,
      user_id: userId,
      language: it.language,
      topic_id: it.topicId,
      kind: it.kind,
      payload: it.payload,
      payload_hash: it.payloadHash,
      eval_kind: it.evalKind,
      eval_spec: it.evalSpec,
      status: it.status,
      batch_id: it.batchId,
      generated_at: it.generatedAt,
      served_at: it.servedAt,
      submitted_at: it.submittedAt,
      score: it.score,
    }));
    const { error } = await supabase
      .from("exercise_pool")
      .upsert(rows, { onConflict: "id" });
    if (error) console.warn("[exercisePoolSync] ingestBatch failed:", error.message);
  } catch (err) {
    console.warn("[exercisePoolSync] ingestBatch threw:", err);
  }

  return merged;
}
