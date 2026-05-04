import { VocabularyItem } from "@/types";
import { supabase } from "./supabase";
import {
  loadVocabulary as loadLocal,
  saveVocabulary as saveLocal,
} from "./vocabulary";

/**
 * Vocabulary sync — Supabase as source of truth, localStorage as offline cache.
 *
 * Mirrors the pattern in {@link ./learnerModelSync.ts}: signed-in users get
 * server-backed persistence (so logging in on another device restores the
 * deck); signed-out / localhost-bypass users fall back to localStorage.
 *
 * The DB shape is `vocabulary_items` (one row per word per user). RLS
 * already restricts each row to its owner.
 */

interface VocabularyRow {
  id: string;
  user_id: string;
  lemma: string;
  inflection: string | null;
  part_of_speech: VocabularyItem["partOfSpeech"];
  gender: VocabularyItem["gender"] | null;
  plural: string | null;
  cefr_level: VocabularyItem["cefrLevel"];
  structure_id: string | null;
  example_sentence: string;
  l1_translation: string;
  introduced: string;
  last_reviewed: string | null;
  due_at: string;
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
}

function rowToItem(row: VocabularyRow): VocabularyItem {
  const item: VocabularyItem = {
    id: row.id,
    lemma: row.lemma,
    partOfSpeech: row.part_of_speech,
    cefrLevel: row.cefr_level,
    exampleSentence: row.example_sentence,
    l1Translation: row.l1_translation,
    introduced: row.introduced,
    lastReviewed: row.last_reviewed,
    dueAt: row.due_at,
    interval: row.interval_days,
    easeFactor: row.ease_factor,
    repetitions: row.repetitions,
    lapses: row.lapses,
  };
  if (row.inflection) item.inflection = row.inflection;
  if (row.gender) item.gender = row.gender;
  if (row.plural) item.plural = row.plural;
  if (row.structure_id) item.structureId = row.structure_id;
  return item;
}

function itemToRow(item: VocabularyItem, userId: string): VocabularyRow {
  return {
    id: item.id,
    user_id: userId,
    lemma: item.lemma,
    inflection: item.inflection ?? null,
    part_of_speech: item.partOfSpeech,
    gender: item.gender ?? null,
    plural: item.plural ?? null,
    cefr_level: item.cefrLevel,
    structure_id: item.structureId ?? null,
    example_sentence: item.exampleSentence,
    l1_translation: item.l1Translation,
    introduced: item.introduced,
    last_reviewed: item.lastReviewed,
    due_at: item.dueAt,
    interval_days: item.interval,
    ease_factor: item.easeFactor,
    repetitions: item.repetitions,
    lapses: item.lapses,
  };
}

/**
 * Load the learner's vocabulary deck.
 *
 * If a userId is passed, Supabase is the source of truth. We mirror the
 * result back to localStorage so refreshes are fast and offline-tolerant.
 * Without a userId (or on a Supabase failure) we fall back to local cache.
 */
export async function loadVocabulary(userId: string | null): Promise<VocabularyItem[]> {
  if (!userId) return loadLocal();

  try {
    const { data, error } = await supabase
      .from("vocabulary_items")
      .select("*")
      .eq("user_id", userId)
      .order("introduced", { ascending: true });

    if (error) {
      console.warn("[vocabularySync] load failed:", error.message);
      return loadLocal();
    }

    const items = ((data ?? []) as VocabularyRow[]).map(rowToItem);
    saveLocal(items); // mirror for next quick refresh
    return items;
  } catch (err) {
    console.warn("[vocabularySync] load threw:", err);
    return loadLocal();
  }
}

/**
 * Upsert a single vocabulary item. Always writes localStorage immediately
 * (so the UI feels snappy); fires Supabase write fire-and-forget when
 * signed in. Suppress-on-conflict via the `(user_id, lemma)` unique key.
 */
export async function upsertVocabularyItem(
  item: VocabularyItem,
  userId: string | null
): Promise<void> {
  // Local — synchronous, always
  const existing = loadLocal();
  const next = existing.some((it) => it.id === item.id)
    ? existing.map((it) => (it.id === item.id ? item : it))
    : [...existing, item];
  saveLocal(next);

  if (!userId) return;

  try {
    const row = itemToRow(item, userId);
    const { error } = await supabase
      .from("vocabulary_items")
      .upsert(row, { onConflict: "user_id,lemma" });

    if (error) {
      console.warn("[vocabularySync] upsert failed:", error.message);
    }
  } catch (err) {
    console.warn("[vocabularySync] upsert threw:", err);
  }
}

/**
 * Bulk replace the deck — used after a "Add all" proposal acceptance or
 * any other batch op. Writes localStorage immediately, then upserts the
 * delta to Supabase. Items not in `nextDeck` that exist server-side are
 * deleted, so this is true replacement semantics.
 */
export async function saveVocabularyDeck(
  nextDeck: VocabularyItem[],
  userId: string | null
): Promise<void> {
  saveLocal(nextDeck);
  if (!userId) return;

  try {
    // Pull current ids to compute deletions
    const { data: existing, error: fetchErr } = await supabase
      .from("vocabulary_items")
      .select("id")
      .eq("user_id", userId);

    if (fetchErr) {
      console.warn("[vocabularySync] saveDeck fetch failed:", fetchErr.message);
      return;
    }

    const existingIds = (existing ?? []).map((r) => r.id);
    const nextIds = new Set(nextDeck.map((it) => it.id));
    const toDelete = existingIds.filter((id) => !nextIds.has(id));

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from("vocabulary_items")
        .delete()
        .eq("user_id", userId)
        .in("id", toDelete);
      if (delErr) console.warn("[vocabularySync] delete failed:", delErr.message);
    }

    if (nextDeck.length > 0) {
      const rows = nextDeck.map((it) => itemToRow(it, userId));
      const { error: upErr } = await supabase
        .from("vocabulary_items")
        .upsert(rows, { onConflict: "user_id,lemma" });
      if (upErr) console.warn("[vocabularySync] upsert batch failed:", upErr.message);
    }
  } catch (err) {
    console.warn("[vocabularySync] saveDeck threw:", err);
  }
}

/** Remove a single item by id. */
export async function removeVocabularyItem(
  itemId: string,
  userId: string | null
): Promise<void> {
  const existing = loadLocal();
  saveLocal(existing.filter((it) => it.id !== itemId));

  if (!userId) return;

  try {
    const { error } = await supabase
      .from("vocabulary_items")
      .delete()
      .eq("user_id", userId)
      .eq("id", itemId);
    if (error) console.warn("[vocabularySync] delete failed:", error.message);
  } catch (err) {
    console.warn("[vocabularySync] delete threw:", err);
  }
}
