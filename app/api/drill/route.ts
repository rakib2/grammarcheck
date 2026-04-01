import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildDrillEvalPrompt } from "@/lib/lessonEngine";
import { getLessonById } from "@/lib/curriculum";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { lessonId, drillIndex, answer } = await request.json();

    if (!lessonId || drillIndex === undefined || !answer) {
      return NextResponse.json(
        { error: "Missing required fields: lessonId, drillIndex, answer" },
        { status: 400 }
      );
    }

    const lesson = getLessonById(lessonId);
    if (!lesson || drillIndex >= lesson.drillPrompts.length) {
      return NextResponse.json({ error: "Invalid lesson or drill index" }, { status: 400 });
    }

    const systemPrompt = buildDrillEvalPrompt(lesson, lesson.drillPrompts[drillIndex]);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: `My answer: "${answer}"` }],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    const result = JSON.parse(content.text);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Drill evaluation error:", error);
    return NextResponse.json({ error: "Failed to evaluate drill" }, { status: 500 });
  }
}
