import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  CefrLevel,
  PooledExercise,
  PooledExerciseEvalKind,
  VocabularyPos,
} from "@/types";

/**
 * Vocabulary-focused worksheet generator.
 *
 * Sibling of {@link /api/worksheet/generate} but anchored on a single
 * lemma instead of a lesson topic. Items are stored under
 * `topicId = vocab:<lemma>` so they don't bleed into the lesson pool.
 *
 * All items use `mode = 'complete'` and `eval_kind ∈ {exact_match,
 * set_membership}` so submit-time grading stays local.
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

interface RawItem {
  prompt?: unknown;
  answer?: unknown;
  acceptable?: unknown;
  hint?: unknown;
}

interface ValidatedItem {
  prompt: string;
  answer: string;
  acceptable: string[];
  hint: string;
}

function validateItem(raw: unknown): ValidatedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawItem;
  const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
  const answer = typeof r.answer === "string" ? r.answer.trim() : "";
  if (!prompt || !answer) return null;
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

function buildSystem(args: {
  lemma: string;
  partOfSpeech: VocabularyPos;
  cefrLevel: CefrLevel;
  gender: string | null;
  plural: string | null;
  example: string;
  l1Translation: string;
  itemCount: number;
}): string {
  const { lemma, partOfSpeech, cefrLevel, gender, plural, example, l1Translation, itemCount } = args;
  const genderLine = gender ? `Gender: ${gender}` : "";
  const pluralLine = plural ? `Plural: ${plural}` : "";

  return `You generate a printable single-word worksheet of fill-in-the-blank items for a German learning app.

Word: "${lemma}" (${partOfSpeech}, ${cefrLevel})
${genderLine}
${pluralLine}
English meaning (reference): ${l1Translation}
Example sentence (reference, do NOT reuse verbatim): ${example}

Return ONLY valid JSON:
{
  "items": [
    {
      "prompt": string,        // sentence with ONE blank, marked "___" (three underscores)
      "answer": string,        // the canonical correct fill (one word or short phrase)
      "acceptable": string[],  // OPTIONAL — other accepted forms; omit/empty if only one is right
      "hint": string           // brief hint (e.g. infinitive form, English gloss)
    }
  ]
}

Hard rules:
- Generate exactly ${itemCount} items.
- EVERY item MUST require the learner to fill in some form of "${lemma}".
- Vary the grammatical context: different subjects, tenses (when applicable), persons, cases.
- Keep prompts at ${cefrLevel} difficulty; common vocabulary, not obscure.
- Use exactly one blank marked "___" per prompt.
- Keep prompts short (5–12 words) so the printed sheet fits cleanly.
- If multiple forms are valid (e.g. word-order variants), include them in "acceptable".`;
}

interface VocabWorksheetRequest {
  lemma?: string;
  partOfSpeech?: VocabularyPos;
  cefrLevel?: CefrLevel;
  gender?: string | null;
  plural?: string | null;
  example?: string;
  l1Translation?: string;
  itemCount?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as VocabWorksheetRequest;
    const { lemma, partOfSpeech, cefrLevel, gender, plural, example, l1Translation, itemCount } = body;

    if (!lemma || !partOfSpeech || !cefrLevel || !example || !l1Translation) {
      return NextResponse.json(
        { error: "Missing required fields", items: [] },
        { status: 400 }
      );
    }

    const size = Math.min(Math.max(itemCount ?? WORKSHEET_SIZE_DEFAULT, 5), WORKSHEET_SIZE_MAX);
    const batchId = randomUUID();
    const language = "de";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2400,
      system: buildSystem({
        lemma,
        partOfSpeech,
        cefrLevel,
        gender: gender ?? null,
        plural: plural ?? null,
        example,
        l1Translation,
        itemCount: size,
      }),
      messages: [
        {
          role: "user",
          content: `Generate the worksheet for "${lemma}". Worksheet batch id: ${batchId}.`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    const parsed = extractJSON(block.text);
    const rawItems = Array.isArray(parsed.items) ? (parsed.items as unknown[]) : [];

    const accepted: PooledExercise[] = [];
    const seenInBatch = new Set<string>();
    for (const raw of rawItems) {
      const v = validateItem(raw);
      if (!v) continue;
      const payloadHash = hashPromptServer(v.prompt);
      if (seenInBatch.has(payloadHash)) continue;
      seenInBatch.add(payloadHash);

      const evalKind: PooledExerciseEvalKind =
        v.acceptable.length > 0 ? "set_membership" : "exact_match";
      const evalSpec =
        evalKind === "set_membership"
          ? { acceptable: [v.answer, ...v.acceptable.filter((a) => a !== v.answer)] }
          : { answer: v.answer };

      accepted.push({
        id: randomUUID(),
        language,
        topicId: `vocab:${lemma}`,
        kind: "worksheet",
        payload: {
          prompt: v.prompt,
          expectedAnswer: v.answer,
          hint: v.hint,
          targetSkill: lemma,
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
    console.error("Vocab worksheet generate error:", error);
    return NextResponse.json(
      { error: "Vocab worksheet generation failed", items: [] },
      { status: 200 }
    );
  }
}
