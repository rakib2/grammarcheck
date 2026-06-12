import { NextRequest, NextResponse } from "next/server";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import { buildTranslateEvalSystem } from "@/lib/lessonEngine";
import { getLessonById } from "@/lib/curriculum";
import { TranslationEvalResult, TranslationIssue } from "@/types";

/**
 * POST /api/translate/eval
 *
 * Grades a learner's German translation against an English source. Returns a
 * score (0–100), a `correct` flag (>=70), short feedback, and a clean
 * reference answer.
 *
 * Body: { lessonId, english, germanReference, answer }
 * 200:  { score, correct, feedback, correctAnswer }
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJSON(text: string): Record<string, unknown> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    if (start === -1) throw new Error("No JSON in response");
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const char = trimmed[i];
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
        return JSON.parse(trimmed.slice(start, i + 1));
      }
    }
    throw new Error("Unterminated JSON response");
  }
}

function fallbackEval(
  answer: string,
  germanReference: string,
  reason = "The slow translation check did not finish, so compare your answer with the reference."
): TranslationEvalResult {
  const exact = !!germanReference && normalize(answer) === normalize(germanReference);
  return {
    score: exact ? 100 : 0,
    correct: exact,
    feedback: exact ? "That matches the reference translation." : reason,
    correctAnswer: germanReference,
    issues: exact
      ? []
      : [
          {
            original: answer,
            correction: germanReference,
            explanation: reason,
            severity: "major",
          },
        ],
    nextStep: exact ? "Try the next prompt without hints." : "Rewrite the sentence using the reference as a model.",
  };
}

export async function POST(request: NextRequest) {
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  let fallbackAnswer = "";
  let fallbackReference = "";
  try {
    const { lessonId, english, germanReference, answer } = await request.json();
    fallbackAnswer = typeof answer === "string" ? answer : "";
    fallbackReference = typeof germanReference === "string" ? germanReference : "";
    if (!lessonId || !english || !answer) {
      return NextResponse.json(
        { error: "Missing required fields: lessonId, english, answer" },
        { status: 400 }
      );
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    const reference = typeof germanReference === "string" ? germanReference : "";

    if (reference && normalize(answer) === normalize(reference)) {
      return NextResponse.json(fallbackEval(answer, reference));
    }

    const message = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system: buildTranslateEvalSystem(lesson, english, reference),
        messages: [
          { role: "user", content: `My answer: "${answer}"` },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("translate_eval_timeout")), 8000)
      ),
    ]);

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    const parsed = extractJSON(block.text);

    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((raw): TranslationIssue | null => {
            if (!raw || typeof raw !== "object") return null;
            const issue = raw as Record<string, unknown>;
            const original = typeof issue.original === "string" ? issue.original : "";
            const correction = typeof issue.correction === "string" ? issue.correction : "";
            const explanation =
              typeof issue.explanation === "string" ? issue.explanation : "";
            const severity = issue.severity === "minor" ? "minor" : "major";
            return explanation || correction
              ? { original, correction, explanation, severity }
              : null;
          })
          .filter((issue): issue is TranslationIssue => issue !== null)
      : [];
    const result: TranslationEvalResult = {
      score: Math.max(0, Math.min(100, Math.round(score))),
      correct: typeof parsed.correct === "boolean" ? parsed.correct : score >= 70,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      correctAnswer:
        typeof parsed.correctAnswer === "string" ? parsed.correctAnswer : reference,
      issues,
      nextStep:
        typeof parsed.nextStep === "string"
          ? parsed.nextStep
          : "Try one more sentence with the same grammar focus.",
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Translate eval error:", error);
    return NextResponse.json(fallbackEval(fallbackAnswer, fallbackReference));
  }
}
