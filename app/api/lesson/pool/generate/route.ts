import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getLessonById } from "@/lib/curriculum";
import {
  ADAPTIVE_DRILL_MAX_ITEMS,
  TRANSLATE_PROMPT_COUNT,
} from "@/lib/lessonEngine";
import { ErrorPattern, PooledExercise, PooledExerciseEvalKind, PooledExerciseKind } from "@/types";

/**
 * Pool generator — produces a fresh batch of pre-graded exercises for a
 * (user, topic) pair. Called from the client both at cold-start and as a
 * fire-and-forget background refill when the local pool runs low.
 *
 * Returns the batch as PooledExercise[]; the client persists via
 * lib/exercisePoolSync.ingestBatch (RLS-authorised under the user's session).
 *
 * The route does NOT write to Supabase itself — keeping Anthropic + Supabase
 * concerns separated and avoiding the need for a service-role key on this path.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_EVAL_KINDS: PooledExerciseEvalKind[] = [
  "exact_match",
  "set_membership",
  "regex",
  "llm",
];

const VALID_KINDS: PooledExerciseKind[] = [
  "drill",
  "translate",
  "error_spot",
  "story",
  "worksheet",
];

function extractJSON(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in response");
    return JSON.parse(match[0]);
  }
}

function hashPromptServer(prompt: string): string {
  const text = prompt.trim().toLowerCase();
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

interface RawItem {
  kind?: unknown;
  payload?: unknown;
  evalKind?: unknown;
  evalSpec?: unknown;
}

/**
 * Validate a single raw item from Claude's response. Returns a fully-formed
 * PooledExercise (without user_id — that's filled at insert time) or null
 * if it fails the schema check or topic/diversity guardrails.
 */
function validateItem(
  raw: unknown,
  topicId: string,
  language: string,
  batchId: string,
  excludedHashes: Set<string>
): PooledExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawItem;

  const kind = typeof r.kind === "string" ? r.kind : "";
  if (!VALID_KINDS.includes(kind as PooledExerciseKind)) return null;

  const evalKind = typeof r.evalKind === "string" ? r.evalKind : "";
  if (!VALID_EVAL_KINDS.includes(evalKind as PooledExerciseEvalKind)) return null;

  const payload = r.payload && typeof r.payload === "object"
    ? (r.payload as Record<string, unknown>)
    : null;
  if (!payload) return null;

  // Each kind has a required canonical-prompt field. We hash that field
  // for dedup. If it's missing, the item is malformed.
  const promptField =
    kind === "translate"
      ? typeof payload.english === "string" ? payload.english : ""
      : kind === "error_spot"
      ? typeof payload.brokenSentence === "string" ? payload.brokenSentence : ""
      : typeof payload.prompt === "string" ? payload.prompt : "";

  if (!promptField.trim()) return null;

  const payloadHash = hashPromptServer(promptField);
  if (excludedHashes.has(payloadHash)) return null;

  const evalSpec = r.evalSpec && typeof r.evalSpec === "object"
    ? (r.evalSpec as Record<string, unknown>)
    : {};

  // Cross-check: if Claude says exact_match it must include an `answer` string.
  if (evalKind === "exact_match" && typeof evalSpec.answer !== "string") return null;
  if (evalKind === "set_membership" && !Array.isArray(evalSpec.acceptable)) return null;
  if (evalKind === "regex" && typeof evalSpec.pattern !== "string") return null;

  return {
    id: randomUUID(),
    language,
    topicId,
    kind: kind as PooledExerciseKind,
    payload,
    payloadHash,
    evalKind: evalKind as PooledExerciseEvalKind,
    evalSpec,
    status: "pending",
    batchId,
    generatedAt: new Date().toISOString(),
    servedAt: null,
    submittedAt: null,
    score: null,
  };
}

interface PromptAdaptation {
  difficulty: "easy" | "balanced" | "hard";
  mastery: number | null;
  recentAverageScore: number | null;
  recentSubmissionCount: number;
  modeMix: { recognize: number; complete: number; transform: number; produce: number; recall: number };
  dependentWeakStructures: { id: string; name: string; mastery: number }[];
}

function buildSystemPrompt(args: {
  lessonTitle: string;
  cefrLevel: string;
  grammarFocus: string;
  teachContent: string;
  topicId: string;
  batchSize: number;
  adaptation: PromptAdaptation | null;
}): string {
  const { lessonTitle, cefrLevel, grammarFocus, teachContent, topicId, batchSize, adaptation } = args;
  const adaptationBlock = adaptation
    ? `
Learner adaptation profile (use this to shape difficulty + mode mix):
- Mastery on this structure: ${adaptation.mastery === null ? "unseen (cold start — give a friendly ramp)" : `${Math.round(adaptation.mastery * 100)}%`}
- Recent score signal: ${
        adaptation.recentSubmissionCount > 0
          ? `${Math.round((adaptation.recentAverageScore ?? 0) * 100)}% average over last ${adaptation.recentSubmissionCount} submission${adaptation.recentSubmissionCount === 1 ? "" : "s"}`
          : "no recent submissions"
      }
- Target difficulty: ${adaptation.difficulty} ${adaptation.difficulty === "easy" ? "(prioritize recognize/complete; minimize produce/recall)" : adaptation.difficulty === "hard" ? "(prioritize produce/recall; minimize recognize)" : "(standard ramp)"}
- Suggested drill mode mix (proportions out of 1.0): recognize=${adaptation.modeMix.recognize}, complete=${adaptation.modeMix.complete}, transform=${adaptation.modeMix.transform}, produce=${adaptation.modeMix.produce}, recall=${adaptation.modeMix.recall}
${
  adaptation.dependentWeakStructures.length > 0
    ? `- Sneak-in review candidates (the learner is also weak on these — fair to include 1 light review item that touches one of them while still requiring ${grammarFocus}):\n${adaptation.dependentWeakStructures
        .map((s) => `  • ${s.name} (${Math.round(s.mastery * 100)}% mastery)`)
        .join("\n")}`
    : ""
}
`
    : "";

  return `You generate a fresh batch of practice exercises for a German grammar app.

Topic: "${lessonTitle}" (${cefrLevel})
Topic ID (must match exactly in every item's payload.targetSkill where applicable): ${topicId}
Grammar focus: ${grammarFocus}
Core lesson content:
${teachContent}
${adaptationBlock}
Return ONLY valid JSON in this shape:
{
  "items": [
    {
      "kind": "drill" | "translate" | "error_spot" | "story",
      "payload": { ... },        // shape depends on kind, see below
      "evalKind": "exact_match" | "set_membership" | "regex" | "llm",
      "evalSpec": { ... }        // shape depends on evalKind, see below
    }
  ],
  "referenceExamples": [
    { "german": string, "translation": string, "note": string }
    // 4–6 fresh, level-appropriate sentences that demonstrate the grammar
    // focus in action. These render alongside the static reference table —
    // table = the rule, referenceExamples = the rule applied.
  ]
}

Payload shapes by kind:
  drill:      { "mode": "recognize"|"complete"|"transform"|"produce"|"recall"|"story",
                "prompt": string, "expectedAnswer": string, "hint": string, "targetSkill": string }
  translate:  { "english": string, "germanReference": string, "hints": string[] }
  error_spot: { "brokenSentence": string, "correction": string, "explanation": string }
  story:      { "prompt": string, "scenario": string, "targetSkill": string }

EvalSpec shapes by evalKind:
  exact_match    → { "answer": string }                          // normalized string equality
  set_membership → { "acceptable": string[] }                    // any one matches
  regex          → { "pattern": string, "hint": string }         // case-insensitive, JS regex
  llm            → { }                                           // free-form, must hit /api/lesson/eval

Tagging rules — pick the cheapest evalKind that's correct:
- Fill-in-the-blank "complete" drills with one right answer → exact_match (use evalSpec.answer).
- "complete"/"transform" drills with a small set of valid forms (e.g. dropping a comma, two word orders) → set_membership.
- Article/gender drills, declension drills → set_membership of acceptable variants.
- error_spot where the corrected sentence has only one accepted form → exact_match on payload.correction.
- Free-form translate prompts and story prompts → llm.
- Regex is for cases where any answer matching a pattern is acceptable (rare; prefer set_membership).

Batch composition (total ${batchSize} items):
- Roughly half "drill" items (${Math.ceil(batchSize / 2)}), spread across modes (ramp recognize → complete → transform → produce).
- ~${Math.max(2, Math.floor(batchSize / 4))} "translate" items.
- ~${Math.max(1, Math.floor(batchSize / 6))} "error_spot" items.
- 1 "story" item.

Reference examples:
- Generate 4–6 short sentences that demonstrate the grammar focus naturally.
- These are NOT exercises — no answer required. They're shown alongside the
  static reference table so the learner sees the rule applied to fresh content
  every visit (instead of seeing the same hardcoded examples forever).
- Different from any example you generate inside drill/translate items.

Hard constraints:
- Every item MUST naturally require the grammar focus.
- All language at ${cefrLevel}; vocabulary common, not obscure.
- Each prompt unique within this batch.
- Prefer deterministic eval (exact_match / set_membership) wherever the answer is constrained.`;
}

interface PoolGenerateRequest {
  lessonId?: string;
  nativeLanguage?: string | null;
  errorPatterns?: ErrorPattern[];
  batchSize?: number;
  excludeHashes?: string[];
  adaptation?: PromptAdaptation;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PoolGenerateRequest;
    const { lessonId, nativeLanguage, errorPatterns, batchSize, excludeHashes, adaptation } = body;

    if (!lessonId) {
      return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    const size = Math.min(Math.max(batchSize ?? ADAPTIVE_DRILL_MAX_ITEMS, 4), 16);
    const batchId = randomUUID();
    const language = "de";
    const excludedHashes = new Set<string>(excludeHashes ?? []);

    const pastMistakes = (errorPatterns ?? [])
      .slice(0, 5)
      .map((e) => `- ${e.example} -> ${e.correction} (${e.count}x)`)
      .join("\n");

    const system = buildSystemPrompt({
      lessonTitle: lesson.title,
      cefrLevel: lesson.cefrLevel,
      grammarFocus: lesson.grammarFocus,
      teachContent: lesson.teachContent,
      topicId: lesson.id,
      batchSize: size,
      adaptation: adaptation ?? null,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      system,
      messages: [
        {
          role: "user",
          content:
            `Native language: ${nativeLanguage ?? "English"}\n` +
            `Batch id: ${batchId}\n` +
            `Generate a fresh batch; do not repeat prompts the learner has already seen.\n` +
            `Past mistakes for recall, if useful:\n${pastMistakes || "(none yet)"}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    const parsed = extractJSON(block.text);
    const rawItems = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];

    // Validate each item; reject items that fail the schema or duplicate
    // a hash from a recent batch (diversity guard).
    const accepted: PooledExercise[] = [];
    const seenInBatch = new Set<string>();
    for (const raw of rawItems) {
      const combined = new Set<string>(excludedHashes);
      seenInBatch.forEach((h) => combined.add(h));
      const item = validateItem(raw, lesson.id, language, batchId, combined);
      if (!item) continue;
      seenInBatch.add(item.payloadHash);
      accepted.push(item);
    }

    // Reference examples — language-vetted illustrations that pair with the
    // static grammar table. Not exercises (no eval, no lifecycle), so they
    // ride the API response alongside `items` and get persisted via the
    // lesson chat cache rather than the exercise_pool table.
    const rawRefs = Array.isArray(parsed.referenceExamples)
      ? (parsed.referenceExamples as unknown[])
      : [];
    const referenceExamples = rawRefs
      .map((raw): { german: string; translation: string; note: string } | null => {
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        const german = typeof r.german === "string" ? r.german.trim() : "";
        if (!german) return null;
        return {
          german,
          translation: typeof r.translation === "string" ? r.translation.trim() : "",
          note: typeof r.note === "string" ? r.note.trim() : "",
        };
      })
      .filter((x): x is { german: string; translation: string; note: string } => x !== null)
      .slice(0, 6);

    if (accepted.length === 0) {
      return NextResponse.json(
        { error: "No valid items generated", batchId, items: [], referenceExamples },
        { status: 200 }
      );
    }

    return NextResponse.json({ batchId, items: accepted, referenceExamples });
  } catch (error) {
    console.error("Pool generate error:", error);
    return NextResponse.json(
      { error: "Pool generation failed", items: [] },
      { status: 200 }
    );
  }
}
