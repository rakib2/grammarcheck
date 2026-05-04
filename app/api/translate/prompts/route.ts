import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildTranslatePromptsSystem, TRANSLATE_PROMPT_COUNT } from "@/lib/lessonEngine";
import { getLessonById } from "@/lib/curriculum";

/**
 * POST /api/translate/prompts
 *
 * Generates the translate-phase prompts for a lesson — one AI call returns all
 * three English-→-German pairs plus hint tokens. The client caches them in
 * component state for the duration of the phase; no second call needed.
 *
 * Body:  { lessonId: string }
 * 200:   { prompts: { english, germanReference, hints[] }[] }
 */

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface PromptItem {
  english: string;
  germanReference: string;
  hints: string[];
}

export async function POST(request: NextRequest) {
  try {
    const { lessonId } = await request.json();
    if (!lessonId) {
      return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: buildTranslatePromptsSystem(lesson),
      messages: [
        {
          role: "user",
          content: `Generate ${TRANSLATE_PROMPT_COUNT} translation prompts for this lesson.`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") {
      throw new Error("Unexpected response shape");
    }

    let parsed: { prompts: unknown[] };
    try {
      parsed = JSON.parse(block.text);
    } catch {
      const m = block.text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON in response");
      parsed = JSON.parse(m[0]);
    }
    if (!Array.isArray(parsed.prompts)) {
      throw new Error("Response missing 'prompts' array");
    }

    const validated: PromptItem[] = [];
    for (const raw of parsed.prompts as Record<string, unknown>[]) {
      const english = typeof raw.english === "string" ? raw.english.trim() : "";
      const germanReference = typeof raw.germanReference === "string" ? raw.germanReference.trim() : "";
      const hints = Array.isArray(raw.hints)
        ? (raw.hints as unknown[])
            .filter((h): h is string => typeof h === "string")
            .map((h) => h.trim())
            .filter(Boolean)
        : [];
      if (english && germanReference && hints.length > 0) {
        validated.push({ english, germanReference, hints });
      }
    }

    if (validated.length === 0) {
      return NextResponse.json(
        { error: "No valid prompts generated" },
        { status: 502 }
      );
    }

    return NextResponse.json({ prompts: validated });
  } catch (error) {
    console.error("Translate prompts error:", error);
    return NextResponse.json(
      { error: "Failed to generate prompts" },
      { status: 500 }
    );
  }
}
