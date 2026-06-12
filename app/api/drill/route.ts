import { NextRequest, NextResponse } from "next/server";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import { buildDrillEvalPrompt } from "@/lib/lessonEngine";
import { getLessonById } from "@/lib/curriculum";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackEval(answer: string, expectedAnswer?: string) {
  const expected = typeof expectedAnswer === "string" ? expectedAnswer.trim() : "";
  if (expected) {
    const correct = normalize(answer) === normalize(expected);
    return {
      correct,
      feedback: correct
        ? "That matches the target form."
        : "I couldn't complete the slow AI check, so use the model answer for this item.",
      correctAnswer: expected,
    };
  }

  return {
    correct: false,
    feedback: "I couldn't complete the slow AI check. Try comparing your answer with the target grammar and continue.",
    correctAnswer: "",
  };
}

function extractJSON(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    if (start === -1) throw new Error("No JSON object in drill response");
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < withoutFence.length; i++) {
      const char = withoutFence[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        return JSON.parse(withoutFence.slice(start, i + 1));
      }
    }
    throw new Error("Unterminated JSON object in drill response");
  }
}

function isDrillEvalResult(value: unknown): value is {
  correct: boolean;
  feedback: string;
  correctAnswer: string;
} {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.correct === "boolean" && typeof result.feedback === "string";
}

export async function POST(request: NextRequest) {
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  let fallbackAnswer = "";
  let fallbackExpectedAnswer: string | undefined;
  try {
    const { lessonId, drillIndex, answer, drillPrompt, expectedAnswer, targetSkill } = await request.json();
    fallbackAnswer = answer ?? "";
    fallbackExpectedAnswer = expectedAnswer;

    if (!lessonId || drillIndex === undefined || !answer) {
      return NextResponse.json(
        { error: "Missing required fields: lessonId, drillIndex, answer" },
        { status: 400 }
      );
    }

    const lesson = getLessonById(lessonId);
    if (!lesson || (!drillPrompt && drillIndex >= lesson.drillPrompts.length)) {
      return NextResponse.json({ error: "Invalid lesson or drill index" }, { status: 400 });
    }

    const prompt = typeof drillPrompt === "string" && drillPrompt.trim()
      ? drillPrompt
      : lesson.drillPrompts[drillIndex];
    const systemPrompt = buildDrillEvalPrompt(lesson, prompt, expectedAnswer, targetSkill);

    if (typeof expectedAnswer === "string" && expectedAnswer.trim()) {
      const expected = normalize(expectedAnswer);
      const actual = normalize(answer);
      if (actual === expected) {
        return NextResponse.json(fallbackEval(answer, expectedAnswer));
      }
    }

    const message = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: `My answer: "${answer}"` }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("drill_eval_timeout")), 8000)
      ),
    ]);

    const content = message.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const result = extractJSON(content.text);
    if (!isDrillEvalResult(result)) {
      throw new Error("Invalid drill evaluation JSON");
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Drill evaluation error:", error);
    return NextResponse.json(fallbackEval(fallbackAnswer, fallbackExpectedAnswer));
  }
}
