import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CefrLevel, VocabularyPos } from "@/types";
import { GRAMMAR_STRUCTURES } from "@/lib/grammarStructures";

/**
 * POST /api/vocabulary/propose
 *
 * Generate N German vocabulary suggestions at the learner's level, optionally
 * biased toward a grammar structure they're working on. Returned items have
 * no SRS state — that's filled in client-side when the learner adds them
 * to their deck (lib/vocabulary.newVocabularyItem).
 *
 * Body: {
 *   level: CefrLevel,
 *   nativeLanguage: string,
 *   structureId?: string,
 *   count?: number,             // 1-15, default 6
 *   existingLemmas?: string[],  // already in deck, exclude these
 * }
 */

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface ProposalItem {
  lemma: string;
  inflection?: string;
  partOfSpeech: VocabularyPos;
  gender?: "der" | "die" | "das";
  plural?: string;
  cefrLevel: CefrLevel;
  exampleSentence: string;
  l1Translation: string;
  /** Echoed from request when present, or omitted */
  structureId?: string;
}

interface RequestBody {
  level: CefrLevel;
  nativeLanguage: string;
  structureId?: string;
  count?: number;
  existingLemmas?: string[];
}

const VALID_POS: VocabularyPos[] = [
  "noun", "verb", "adjective", "adverb", "preposition", "particle", "phrase",
];
const VALID_GENDER = ["der", "die", "das"] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body.level || !body.nativeLanguage) {
      return NextResponse.json(
        { error: "Missing required fields: level, nativeLanguage" },
        { status: 400 }
      );
    }

    const count = clamp(Math.round(body.count ?? 6), 1, 15);
    const known = (body.existingLemmas ?? []).slice(0, 200); // cap context
    const structDef = body.structureId
      ? GRAMMAR_STRUCTURES.find((s) => s.id === body.structureId)
      : null;

    const focusLine = structDef
      ? `Bias the words toward ones that frequently appear with the structure "${structDef.name}" (${structDef.description}). Examples: words that take this case, common collocations, related verbs.`
      : `Pick words that a learner at ${body.level} would benefit from in everyday conversation. Spread across nouns, verbs, and a couple of adjectives.`;

    const knownBlock = known.length > 0
      ? `\n\nDO NOT propose any of these lemmas (already in deck): ${known.join(", ")}.`
      : "";

    const systemPrompt = `You are a German vocabulary curator for a learner whose native language is ${body.nativeLanguage} and current level is ${body.level}.

Output ONLY a single JSON object with this exact shape:
{
  "items": [
    {
      "lemma": string,                       // dictionary form, e.g. "essen", "Apfel"
      "inflection": string | null,           // surface form if differs (e.g. "isst" for 3rd-person of essen); null otherwise
      "partOfSpeech": "noun" | "verb" | "adjective" | "adverb" | "preposition" | "particle" | "phrase",
      "gender": "der" | "die" | "das" | null,// nouns only; null for everything else
      "plural": string | null,               // nouns: plural form if applicable; null otherwise
      "cefrLevel": "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
      "exampleSentence": string,             // ONE natural German sentence using the lemma at the learner's level
      "l1Translation": string                // SHORT translation of the lemma in ${body.nativeLanguage} (not the sentence)
    }
  ]
}

Rules:
- Propose exactly ${count} items.
- All items at level ${body.level} or one half-step easier (so they're approachable).
- For nouns, ALWAYS include gender and plural.
- exampleSentence must use the lemma in context, be natural, and stay at ${body.level}.
- l1Translation is the WORD's translation, not the sentence's translation.
- ${focusLine}${knownBlock}
- Do NOT include any prose, comments, or markdown — only the JSON object.`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Propose ${count} vocabulary items for me to learn next.`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      throw new Error("Unexpected response shape from Claude");
    }

    let parsed: { items: unknown[] };
    try {
      parsed = JSON.parse(block.text);
    } catch {
      // Last-ditch: extract first {...} block
      const match = block.text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not parse JSON from model");
      parsed = JSON.parse(match[0]);
    }

    if (!Array.isArray(parsed.items)) {
      throw new Error("Model output missing 'items' array");
    }

    const validated: ProposalItem[] = [];
    for (const raw of parsed.items as Record<string, unknown>[]) {
      const lemma = typeof raw.lemma === "string" ? raw.lemma.trim() : "";
      const pos = raw.partOfSpeech as VocabularyPos;
      const cefr = raw.cefrLevel as CefrLevel;
      const example = typeof raw.exampleSentence === "string" ? raw.exampleSentence.trim() : "";
      const trans = typeof raw.l1Translation === "string" ? raw.l1Translation.trim() : "";
      if (!lemma || !VALID_POS.includes(pos) || !example || !trans) continue;
      const gender = raw.gender as string | null;
      const item: ProposalItem = {
        lemma,
        partOfSpeech: pos,
        cefrLevel: cefr,
        exampleSentence: example,
        l1Translation: trans,
      };
      if (typeof raw.inflection === "string" && raw.inflection.trim()) {
        item.inflection = raw.inflection.trim();
      }
      if (gender && (VALID_GENDER as readonly string[]).includes(gender)) {
        item.gender = gender as "der" | "die" | "das";
      }
      if (typeof raw.plural === "string" && raw.plural.trim()) {
        item.plural = raw.plural.trim();
      }
      if (body.structureId) item.structureId = body.structureId;
      validated.push(item);
    }

    return NextResponse.json({ items: validated });
  } catch (error) {
    console.error("Vocabulary propose error:", error);
    return NextResponse.json(
      { error: "Failed to propose vocabulary" },
      { status: 500 }
    );
  }
}
