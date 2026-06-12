import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "node:crypto";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import {
  CefrLevel,
  PooledExercise,
  PooledExerciseEvalKind,
  VocabularyPos,
} from "@/types";

/**
 * Per-word vocabulary practice generator.
 *
 * Produces 4–5 fast-graded exercises focused on a single lemma. All items
 * are tagged with `eval_kind = 'exact_match' | 'set_membership'`, so the
 * client grades them locally via {@link evaluateLocally} — no LLM
 * round-trip on submit. Items return as `PooledExercise[]` (kind='drill')
 * so they can be persisted via the existing `ingestBatch` flow if the
 * caller chooses.
 */


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
  mode?: unknown;
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
  const posSpecific =
    partOfSpeech === "verb"
      ? `Include items that exercise conjugation across persons (ich, du, er/sie, wir, ihr, sie/Sie). Use the verb in plausible everyday contexts.`
      : partOfSpeech === "noun"
      ? `Include items that exercise the article + case (Nominativ / Akkusativ / Dativ as appropriate for ${cefrLevel}). Use the noun in natural contexts.`
      : partOfSpeech === "adjective"
      ? `Include items that exercise predicate use (ist + adj.) and at least one attributive use with declension when possible at ${cefrLevel}.`
      : `Use the lemma naturally in 4–5 different short contexts.`;

  return `You generate a tight set of fill-in-the-blank exercises focused on ONE German word.

Word: "${lemma}" (${partOfSpeech}, ${cefrLevel})
${genderLine}
${pluralLine}
Example sentence (reference, do NOT reuse verbatim): ${example}
English meaning (reference): ${l1Translation}

Return ONLY valid JSON:
{
  "items": [
    {
      "prompt": string,        // a short sentence with ONE blank marked "___"
      "answer": string,        // the canonical correct fill (one word or short phrase)
      "acceptable": string[],  // OPTIONAL — other accepted forms; omit/empty if only one is right
      "hint": string,          // brief hint (e.g. infinitive, English gloss, person)
      "mode": "fill" | "conjugate" | "decline" | "translate"
    }
  ]
}

Hard rules:
- Generate exactly ${itemCount} items.
- EVERY item MUST require the learner to produce a form of "${lemma}".
- Each prompt has exactly ONE blank marked "___".
- Vary contexts (different subjects, settings) — don't repeat phrasing.
- Keep prompts at ${cefrLevel} difficulty.
- Prefer one canonical answer; only use "acceptable" when there are truly equivalent forms (e.g. "in dem"/"im").

${posSpecific}`;
}

interface VocabPracticeRequest {
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
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  try {
    const body = (await request.json()) as VocabPracticeRequest;
    const {
      lemma,
      partOfSpeech,
      cefrLevel,
      gender,
      plural,
      example,
      l1Translation,
      itemCount,
    } = body;

    if (!lemma || !partOfSpeech || !cefrLevel || !example || !l1Translation) {
      return NextResponse.json(
        { error: "Missing required fields", items: [] },
        { status: 400 }
      );
    }

    const size = Math.min(Math.max(itemCount ?? 5, 3), 8);
    const batchId = randomUUID();
    const language = "de";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
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
          content: `Generate the practice set for "${lemma}". Batch id: ${batchId}.`,
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
      if (!raw || typeof raw !== "object") continue;
      const r = raw as RawItem;
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      const answer = typeof r.answer === "string" ? r.answer.trim() : "";
      if (!prompt || !answer) continue;
      const payloadHash = hashPromptServer(prompt);
      if (seenInBatch.has(payloadHash)) continue;
      seenInBatch.add(payloadHash);

      const acceptable = Array.isArray(r.acceptable)
        ? (r.acceptable as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
      const evalKind: PooledExerciseEvalKind =
        acceptable.length > 0 ? "set_membership" : "exact_match";
      const evalSpec =
        evalKind === "set_membership"
          ? { acceptable: [answer, ...acceptable.filter((a) => a !== answer)] }
          : { answer };

      accepted.push({
        id: randomUUID(),
        language,
        // Tag the per-word practice set under a lemma-scoped topic so it's
        // distinct from regular lesson drills in the pool.
        topicId: `vocab:${lemma}`,
        kind: "drill",
        payload: {
          mode: typeof r.mode === "string" ? r.mode : "fill",
          prompt,
          expectedAnswer: answer,
          hint: typeof r.hint === "string" ? r.hint : "",
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
        { error: "No valid practice items generated", batchId, items: [] },
        { status: 200 }
      );
    }

    return NextResponse.json({ batchId, items: accepted });
  } catch (error) {
    console.error("Vocab practice generate error:", error);
    return NextResponse.json(
      { error: "Vocab practice generation failed", items: [] },
      { status: 200 }
    );
  }
}
