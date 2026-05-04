import {
  PooledExercise,
  PooledExerciseEvalKind,
  PooledExerciseKind,
} from "@/types";
import type {
  DynamicDrillItem,
  DynamicDrillMode,
  DynamicReferenceExample,
  FocusedSessionPlan,
  FocusedTranslatePrompt,
} from "@/lib/lessonEngine";

/**
 * Exercise pool — local-first cache + deterministic eval dispatcher.
 *
 * The pool is per-user / per-topic / per-kind. localStorage holds a slice
 * for instant render; lib/exercisePoolSync.ts mirrors against Supabase as
 * source of truth (same dual-tier shape as vocabulary).
 *
 * The eval dispatcher decides whether a learner's answer can be graded
 * locally (exact_match / set_membership / regex) or needs the LLM eval
 * route (llm). Only the LLM kind incurs an API round-trip.
 */

const STORAGE_KEY = "grammarcoach_exercise_pool";

interface LocalCache {
  /** Keyed by `${topicId}:${kind}` for cheap lookup. */
  byTopicKind: Record<string, PooledExercise[]>;
  /**
   * Reference examples per topic — these don't live in the exercise_pool
   * table because they have no eval/lifecycle, but the chat page still
   * needs them on warm-start (otherwise the rail falls back to the static
   * `buildFallbackFocusedSessionPlan` examples). Refreshed every time the
   * pool generator returns a fresh batch.
   */
  referencesByTopic?: Record<string, DynamicReferenceExample[]>;
}

function emptyCache(): LocalCache {
  return { byTopicKind: {}, referencesByTopic: {} };
}

function cacheKey(topicId: string, kind: PooledExerciseKind): string {
  return `${topicId}:${kind}`;
}

export function loadPoolCache(): LocalCache {
  if (typeof window === "undefined") return emptyCache();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalCache) : emptyCache();
  } catch {
    return emptyCache();
  }
}

export function savePoolCache(cache: LocalCache): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded — non-fatal. Pool is reconstructable from Supabase.
  }
}

/** Read a topic+kind slice from cache. */
export function readSlice(
  topicId: string,
  kind: PooledExerciseKind
): PooledExercise[] {
  const cache = loadPoolCache();
  return cache.byTopicKind[cacheKey(topicId, kind)] ?? [];
}

/** Replace a topic+kind slice in cache. */
export function writeSlice(
  topicId: string,
  kind: PooledExerciseKind,
  items: PooledExercise[]
): void {
  const cache = loadPoolCache();
  cache.byTopicKind[cacheKey(topicId, kind)] = items;
  savePoolCache(cache);
}

/** Merge in new items, dedup by id, keep order stable. */
export function mergeIntoSlice(
  topicId: string,
  kind: PooledExerciseKind,
  fresh: PooledExercise[]
): PooledExercise[] {
  const existing = readSlice(topicId, kind);
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const item of fresh) {
    if (!seen.has(item.id)) {
      merged.push(item);
      seen.add(item.id);
    }
  }
  writeSlice(topicId, kind, merged);
  return merged;
}

/**
 * Cache fresh reference examples for a topic. Called whenever the pool
 * generator returns a new batch with referenceExamples. Subsequent
 * warm-start visits to the same lesson read them via {@link readReferences}.
 */
export function cacheReferences(
  topicId: string,
  examples: DynamicReferenceExample[]
): void {
  if (examples.length === 0) return;
  const cache = loadPoolCache();
  if (!cache.referencesByTopic) cache.referencesByTopic = {};
  cache.referencesByTopic[topicId] = examples;
  savePoolCache(cache);
}

/**
 * Read cached reference examples for a topic. Returns `null` (not `[]`)
 * when nothing is cached so the caller can distinguish "no cache" from
 * "explicitly empty" and decide whether to fall back to the static set.
 */
export function readReferences(
  topicId: string
): DynamicReferenceExample[] | null {
  const cache = loadPoolCache();
  const stored = cache.referencesByTopic?.[topicId];
  return stored && stored.length > 0 ? stored : null;
}

/** Update a single item's status/timestamps locally. */
export function patchItem(
  topicId: string,
  kind: PooledExerciseKind,
  itemId: string,
  patch: Partial<PooledExercise>
): void {
  const slice = readSlice(topicId, kind);
  writeSlice(
    topicId,
    kind,
    slice.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
  );
}

// ── Hashing ──

/**
 * Stable hash of an exercise's canonical prompt. Used by the generator
 * to dedup within a batch and to enforce diversity across recent batches.
 *
 * Browser-side: uses subtle crypto when available (async). Node-side
 * (API routes): re-implemented with `node:crypto` in the API route file
 * — keeping this file dependency-free for client bundles.
 */
export async function hashPrompt(prompt: string): Promise<string> {
  const text = prompt.trim().toLowerCase();
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const buf = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }
  // Fallback: simple FNV-1a — deterministic, collision-prone but fine for
  // the small per-user / per-topic slices we dedup against.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Eval dispatcher ──

/**
 * Result of grading a learner's answer against a pooled exercise.
 * `latencyMs` lets the UI distinguish instant local grading from the
 * LLM round-trip when telemetry matters.
 */
export interface PoolEvalResult {
  correct: boolean;
  score: number;          // 0..1
  feedback: string;
  evaluatedBy: "local" | "llm";
  latencyMs: number;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Local eval — fast path. Returns null if the strategy is `llm` (caller
 * must fall through to /api/lesson/eval).
 */
export function evaluateLocally(
  evalKind: PooledExerciseEvalKind,
  evalSpec: Record<string, unknown>,
  answer: string
): PoolEvalResult | null {
  const start = performance.now();
  const got = normalize(answer);

  if (evalKind === "exact_match") {
    const expected = typeof evalSpec.answer === "string" ? evalSpec.answer : "";
    const correct = normalize(expected) === got;
    return {
      correct,
      score: correct ? 1 : 0,
      feedback: correct ? "Correct." : `Expected: ${expected}`,
      evaluatedBy: "local",
      latencyMs: performance.now() - start,
    };
  }

  if (evalKind === "set_membership") {
    const acceptable = Array.isArray(evalSpec.acceptable)
      ? (evalSpec.acceptable as unknown[]).filter(
          (x): x is string => typeof x === "string"
        )
      : [];
    const correct = acceptable.some((a) => normalize(a) === got);
    return {
      correct,
      score: correct ? 1 : 0,
      feedback: correct ? "Correct." : `Try one of: ${acceptable.join(", ")}`,
      evaluatedBy: "local",
      latencyMs: performance.now() - start,
    };
  }

  if (evalKind === "regex") {
    const pattern = typeof evalSpec.pattern === "string" ? evalSpec.pattern : "";
    if (!pattern) return null;
    try {
      const re = new RegExp(pattern, "i");
      const correct = re.test(answer.trim());
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct
          ? "Correct."
          : typeof evalSpec.hint === "string"
          ? (evalSpec.hint as string)
          : "Not quite.",
        evaluatedBy: "local",
        latencyMs: performance.now() - start,
      };
    } catch {
      return null;
    }
  }

  // llm — caller must hit the API
  return null;
}

// ── Adapter: pool → FocusedSessionPlan ──

/**
 * Map a slice of pooled exercises into the legacy `FocusedSessionPlan` shape
 * the chat page already consumes. Falls back to the supplied `fallbackPlan`
 * for any field the pool doesn't cover (e.g. referenceExamples — those still
 * come from `buildFallbackFocusedSessionPlan` until we add a 'reference'
 * pool kind).
 *
 * Pulls only the kinds the lesson UI knows about today: drill, translate,
 * story. error_spot items in the pool are left in place for future
 * consumers; they don't appear in the FocusedSessionPlan.
 */
export function assemblePlanFromPool(
  items: PooledExercise[],
  fallbackPlan: FocusedSessionPlan,
  options?: { maxDrills?: number; maxTranslate?: number }
): FocusedSessionPlan {
  const maxDrills = options?.maxDrills ?? 8;
  const maxTranslate = options?.maxTranslate ?? 3;

  const drillItems: DynamicDrillItem[] = items
    .filter((e) => e.kind === "drill")
    .slice(0, maxDrills)
    .map((e) => {
      const p = e.payload;
      const mode: DynamicDrillMode =
        p.mode === "recognize" ||
        p.mode === "complete" ||
        p.mode === "transform" ||
        p.mode === "produce" ||
        p.mode === "recall" ||
        p.mode === "story"
          ? p.mode
          : "produce";
      return {
        mode,
        prompt: typeof p.prompt === "string" ? p.prompt : "",
        expectedAnswer: typeof p.expectedAnswer === "string" ? p.expectedAnswer : "",
        hint: typeof p.hint === "string" ? p.hint : "",
        targetSkill: typeof p.targetSkill === "string" ? p.targetSkill : "",
      };
    });

  const translatePrompts: FocusedTranslatePrompt[] = items
    .filter((e) => e.kind === "translate")
    .slice(0, maxTranslate)
    .map((e) => {
      const p = e.payload;
      return {
        english: typeof p.english === "string" ? p.english : "",
        germanReference: typeof p.germanReference === "string" ? p.germanReference : "",
        hints: Array.isArray(p.hints)
          ? (p.hints as unknown[]).filter((h): h is string => typeof h === "string")
          : [],
      };
    });

  const storyItem = items.find((e) => e.kind === "story");
  const storySetup =
    storyItem && typeof storyItem.payload.scenario === "string"
      ? storyItem.payload.scenario
      : storyItem && typeof storyItem.payload.prompt === "string"
      ? storyItem.payload.prompt
      : fallbackPlan.storySetup;

  return {
    source: "ai",
    referenceExamples: fallbackPlan.referenceExamples, // not pooled yet
    drillItems: drillItems.length > 0 ? drillItems : fallbackPlan.drillItems,
    translatePrompts:
      translatePrompts.length > 0 ? translatePrompts : fallbackPlan.translatePrompts,
    storySetup,
  };
}

/**
 * Look up the pooled exercise that backs a given drill/translate/story item
 * in the assembled plan. Used at submit time so the eval dispatcher can
 * decide local-vs-LLM and so we can mark the row submitted.
 *
 * Match keys per kind:
 *   drill:     payload.prompt
 *   translate: payload.english
 *   story:     payload.scenario || payload.prompt
 */
export function findBackingPoolItem(
  items: PooledExercise[],
  kind: PooledExerciseKind,
  matchKey: string
): PooledExercise | null {
  const target = matchKey.trim().toLowerCase();
  return (
    items.find((e) => {
      if (e.kind !== kind) return false;
      const candidate =
        kind === "translate"
          ? e.payload.english
          : kind === "story"
          ? e.payload.scenario ?? e.payload.prompt
          : e.payload.prompt;
      return typeof candidate === "string" && candidate.trim().toLowerCase() === target;
    }) ?? null
  );
}
