import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import { getLessonById } from "@/lib/curriculum";
import { ErrorPattern, PooledExercise } from "@/types";

/**
 * Worksheet generator — produces a self-contained set of fill-in-the-blank
 * items the learner can complete in the browser (or print + fill on paper).
 *
 * Distinct from /api/lesson/pool/generate because the UX is different:
 *   - Worksheets are batched as ONE document (one batch_id)
 *   - All items use mode='complete' (fill-blank) so grading is instant
 *   - eval_kind is always 'exact_match' or 'set_membership' (no LLM round-trips)
 *   - Returned items have kind='worksheet' — they share the exercise_pool
 *     table but stay segregated from session drills
 *
 * The client persists via lib/exercisePoolSync.ingestBatch under RLS.
 */

const WORKSHEET_SIZE_DEFAULT = 10;
const WORKSHEET_SIZE_MAX = 20;

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

interface RawWorksheetItem {
  prompt?: unknown;
  answer?: unknown;
  acceptable?: unknown;
  hint?: unknown;
}

interface ValidatedItem {
  prompt: string;
  answer: string;
  acceptable: string[]; // empty if exact_match
  hint: string;
}

function validateItem(raw: unknown): ValidatedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawWorksheetItem;
  const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
  const answer = typeof r.answer === "string" ? r.answer.trim() : "";
  if (!prompt || !answer) return null;
  // Worksheets are intentionally restricted to fill-blank format — the
  // prompt should contain a blank marker. We don't enforce that strictly
  // (Claude sometimes uses "___" vs "..." vs parens), but we drop empties.
  return {
    prompt,
    answer,
    acceptable: Array.isArray(r.acceptable)
      ? (r.acceptable as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
    hint: typeof r.hint === "string" ? r.hint.trim() : "",
  };
}

function buildWorksheetSystem(args: {
  lessonTitle: string;
  cefrLevel: string;
  grammarFocus: string;
  teachContent: string;
  topicId: string;
  itemCount: number;
}): string {
  const { lessonTitle, cefrLevel, grammarFocus, teachContent, topicId, itemCount } = args;
  return `You generate a printable worksheet of fill-in-the-blank items for a German grammar app.

Topic: "${lessonTitle}" (${cefrLevel})
Topic ID: ${topicId}
Grammar focus: ${grammarFocus}
Core lesson content:
${teachContent}

Return ONLY valid JSON in this shape:
{
  "items": [
    {
      "prompt": string,        // sentence with ONE blank, marked as "___" (three underscores)
      "answer": string,        // the canonical correct fill
      "acceptable": string[],  // OPTIONAL — other accepted forms; omit or empty array if only one is right
      "hint": string           // a brief hint shown next to the blank (e.g. infinitive form, English gloss)
    }
  ]
}

Hard rules:
- Generate exactly ${itemCount} items.
- Every item MUST naturally require ${grammarFocus} to complete.
- Use exactly one blank marked "___" per prompt.
- All language at ${cefrLevel}; vocabulary common, not obscure.
- Keep prompts short (5–12 words) so the printed sheet fits cleanly.
- Vary the surrounding context (different subjects, settings) so the worksheet doesn't feel repetitive.
- If multiple forms are valid (e.g. word-order variants, two synonymous fillers), include them in "acceptable".`;
}

interface WorksheetGenerateRequest {
  lessonId?: string;
  nativeLanguage?: string | null;
  errorPatterns?: ErrorPattern[];
  itemCount?: number;
}

export async function POST(request: NextRequest) {
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  try {
    const body = (await request.json()) as WorksheetGenerateRequest;
    const { lessonId, nativeLanguage, errorPatterns, itemCount } = body;

    if (!lessonId) {
      return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    const size = Math.min(
      Math.max(itemCount ?? WORKSHEET_SIZE_DEFAULT, 5),
      WORKSHEET_SIZE_MAX
    );
    const batchId = randomUUID();
    const language = "de";

    const pastMistakes = (errorPatterns ?? [])
      .slice(0, 5)
      .map((e) => `- ${e.example} -> ${e.correction} (${e.count}x)`)
      .join("\n");

    const system = buildWorksheetSystem({
      lessonTitle: lesson.title,
      cefrLevel: lesson.cefrLevel,
      grammarFocus: lesson.grammarFocus,
      teachContent: lesson.teachContent,
      topicId: lesson.id,
      itemCount: size,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2400,
      system,
      messages: [
        {
          role: "user",
          content:
            `Native language: ${nativeLanguage ?? "English"}\n` +
            `Worksheet batch id: ${batchId}\n` +
            `Past mistakes for material, if useful:\n${pastMistakes || "(none yet)"}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    const parsed = extractJSON(block.text);
    const rawItems = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];

    // Validate + dedupe within the batch; drop malformed items.
    const accepted: PooledExercise[] = [];
    const seenInBatch = new Set<string>();
    for (const raw of rawItems) {
      const v = validateItem(raw);
      if (!v) continue;
      const payloadHash = hashPromptServer(v.prompt);
      if (seenInBatch.has(payloadHash)) continue;
      seenInBatch.add(payloadHash);

      const evalKind = v.acceptable.length > 0 ? "set_membership" : "exact_match";
      const evalSpec =
        evalKind === "set_membership"
          ? { acceptable: [v.answer, ...v.acceptable.filter((a) => a !== v.answer)] }
          : { answer: v.answer };

      accepted.push({
        id: randomUUID(),
        language,
        topicId: lesson.id,
        kind: "worksheet",
        payload: {
          prompt: v.prompt,
          expectedAnswer: v.answer,
          hint: v.hint,
          targetSkill: lesson.grammarFocus,
        },
        payloadHash,
        evalKind,
        evalSpec,
        status: "pending",
        batchId,
        generatedAt: new Date().toISOString(),
        servedAt: null,
        submittedAt: null,
        score: null,
      });
    }

    if (accepted.length === 0) {
      return NextResponse.json(
        { error: "No valid worksheet items generated", batchId, items: [] },
        { status: 200 }
      );
    }

    return NextResponse.json({ batchId, items: accepted });
  } catch (error) {
    console.error("Worksheet generate error:", error);
    return NextResponse.json(
      { error: "Worksheet generation failed", items: [] },
      { status: 200 }
    );
  }
}
