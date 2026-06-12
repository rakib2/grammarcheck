import { NextRequest, NextResponse } from "next/server";
import { makeAnthropicClient, getAnthropicKey } from "@/lib/providerKey";
import { buildErrorSpotEvalSystem } from "@/lib/lessonEngine";
import { getLessonById } from "@/lib/curriculum";

/**
 * POST /api/error-spot/eval
 *
 * Grades a learner's response to an error-detection drill. The buggy and
 * fixed sentences come from their own `errorPatterns` (passed in from the
 * client) so this endpoint stays stateless.
 *
 * Body: { lessonId, buggySentence, fixedSentence, answer }
 * 200:  { score, correct, feedback, correctAnswer }
 */

export async function POST(request: NextRequest) {
  const anthropic = makeAnthropicClient(getAnthropicKey(request));
  try {
    const { lessonId, buggySentence, fixedSentence, answer } = await request.json();
    if (!lessonId || !buggySentence || !fixedSentence || !answer) {
      return NextResponse.json(
        { error: "Missing required fields: lessonId, buggySentence, fixedSentence, answer" },
        { status: 400 }
      );
    }

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: buildErrorSpotEvalSystem(lesson, buggySentence, fixedSentence),
      messages: [{ role: "user", content: `My answer: "${answer}"` }],
    });

    const block = message.content[0];
    if (block.type !== "text") throw new Error("Unexpected response shape");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      const m = block.text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("No JSON in response");
      parsed = JSON.parse(m[0]);
    }

    const score = typeof parsed.score === "number" ? parsed.score : 0;
    const result = {
      score: Math.max(0, Math.min(100, Math.round(score))),
      correct: typeof parsed.correct === "boolean" ? parsed.correct : score >= 70,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      correctAnswer:
        typeof parsed.correctAnswer === "string" ? parsed.correctAnswer : fixedSentence,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error-spot eval error:", error);
    return NextResponse.json(
      { error: "Failed to evaluate" },
      { status: 500 }
    );
  }
}
