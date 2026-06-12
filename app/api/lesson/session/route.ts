import { NextRequest, NextResponse } from "next/server";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import { getLessonById } from "@/lib/curriculum";
import {
  ADAPTIVE_DRILL_MAX_ITEMS,
  buildFallbackFocusedSessionPlan,
  buildFocusedSessionPlanSystem,
  DynamicDrillItem,
  DynamicReferenceExample,
  FocusedTranslatePrompt,
  FocusedSessionPlan,
} from "@/lib/lessonEngine";
import { ErrorPattern } from "@/types";

function extractJSON(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in response");
    return JSON.parse(match[0]);
  }
}

export async function POST(request: NextRequest) {
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  let fallback: FocusedSessionPlan | null = null;
  try {
    const { lessonId, nativeLanguage, errorPatterns, attemptKey } = (await request.json()) as {
      lessonId?: string;
      nativeLanguage?: string | null;
      errorPatterns?: ErrorPattern[];
      attemptKey?: string;
    };

    if (!lessonId) {
      return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }
    fallback = buildFallbackFocusedSessionPlan(lesson);

    const pastMistakes = (errorPatterns ?? [])
      .slice(0, 5)
      .map((e) => `- ${e.example} -> ${e.correction} (${e.count}x)`)
      .join("\n");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2200,
      system: buildFocusedSessionPlanSystem(lesson),
      messages: [
        {
          role: "user",
          content:
            `Native language: ${nativeLanguage ?? "English"}\n` +
            `Session attempt key: ${attemptKey ?? new Date().toISOString()}\n` +
            `Create a fresh set for this attempt; do not repeat the same examples or prompts from a previous run when avoidable.\n` +
            `Past mistakes for recall, if useful:\n${pastMistakes || "(none yet)"}`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    const parsed = extractJSON(block.text);
    const referenceExamples = Array.isArray(parsed.referenceExamples)
      ? (parsed.referenceExamples as Record<string, unknown>[])
          .map((raw): DynamicReferenceExample | null => {
            const german = typeof raw.german === "string" ? raw.german.trim() : "";
            const translation = typeof raw.translation === "string" ? raw.translation.trim() : "";
            const note = typeof raw.note === "string" ? raw.note.trim() : "";
            return german ? { german, translation, note } : null;
          })
          .filter((x): x is DynamicReferenceExample => x !== null)
      : [];

    const drillItems = Array.isArray(parsed.drillItems)
      ? (parsed.drillItems as Record<string, unknown>[])
          .map((raw): DynamicDrillItem | null => {
            const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
            const expectedAnswer =
              typeof raw.expectedAnswer === "string" ? raw.expectedAnswer.trim() : "";
            const hint = typeof raw.hint === "string" ? raw.hint.trim() : "";
            const targetSkill =
              typeof raw.targetSkill === "string" ? raw.targetSkill.trim() : lesson.grammarFocus;
            const mode =
              raw.mode === "recognize" ||
              raw.mode === "complete" ||
              raw.mode === "transform" ||
              raw.mode === "produce" ||
              raw.mode === "recall" ||
              raw.mode === "story"
                ? raw.mode
                : "produce";
            return prompt ? { mode, prompt, expectedAnswer, hint, targetSkill } : null;
          })
          .filter((x): x is DynamicDrillItem => x !== null)
      : [];

    const translatePrompts = Array.isArray(parsed.translatePrompts)
      ? (parsed.translatePrompts as Record<string, unknown>[])
          .map((raw): FocusedTranslatePrompt | null => {
            const english = typeof raw.english === "string" ? raw.english.trim() : "";
            const germanReference =
              typeof raw.germanReference === "string" ? raw.germanReference.trim() : "";
            const hints = Array.isArray(raw.hints)
              ? (raw.hints as unknown[])
                  .filter((h): h is string => typeof h === "string")
                  .map((h) => h.trim())
                  .filter(Boolean)
              : [];
            return english ? { english, germanReference, hints } : null;
          })
          .filter((x): x is FocusedTranslatePrompt => x !== null)
      : [];

    const plan: FocusedSessionPlan = {
      source: "ai",
      referenceExamples: referenceExamples.length > 0 ? referenceExamples : fallback.referenceExamples,
      drillItems: (drillItems.length > 0 ? drillItems : fallback.drillItems).slice(0, ADAPTIVE_DRILL_MAX_ITEMS),
      translatePrompts:
        translatePrompts.length > 0 ? translatePrompts : fallback.translatePrompts,
      storySetup:
        typeof parsed.storySetup === "string"
          ? parsed.storySetup.trim()
          : fallback.storySetup,
    };

    if (plan.drillItems.length === 0) {
      return NextResponse.json(fallback);
    }

    return NextResponse.json(plan);
  } catch (error) {
    console.error("Focused session plan error:", error);
    return NextResponse.json(fallback ?? { error: "Failed to build fallback plan" }, { status: 200 });
  }
}
