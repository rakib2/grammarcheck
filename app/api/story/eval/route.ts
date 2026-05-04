import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getLessonById } from "@/lib/curriculum";
import { buildStoryEvalSystem } from "@/lib/lessonEngine";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request: NextRequest) {
  try {
    const { lessonId, storySetup, answer } = await request.json();
    if (!lessonId || !answer) {
      return NextResponse.json(
        { error: "Missing required fields: lessonId, answer" },
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
      system: buildStoryEvalSystem(lesson, storySetup || ""),
      messages: [{ role: "user", content: `My story answer: "${answer}"` }],
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
    return NextResponse.json({
      score: Math.max(0, Math.min(100, Math.round(score))),
      correct: typeof parsed.correct === "boolean" ? parsed.correct : score >= 70,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      correctAnswer:
        typeof parsed.correctAnswer === "string" ? parsed.correctAnswer : "",
    });
  } catch (error) {
    console.error("Story eval error:", error);
    return NextResponse.json({ error: "Failed to evaluate story answer" }, { status: 500 });
  }
}
