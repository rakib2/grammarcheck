import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CefrLevel } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Placement test prompts — 2 per level, A1 through C1
const PLACEMENT_PROMPTS: { level: CefrLevel; prompt: string }[] = [
  { level: "A1", prompt: "Fill in: Ich ___ Student. (sein)" },
  { level: "A1", prompt: "Fill in: Er ___ einen Hund. (haben)" },
  { level: "A2", prompt: "Fill in: Gestern ___ ich ins Kino ___. (gehen, Perfekt)" },
  { level: "A2", prompt: "Complete: Ich muss heute Abend ___. (arbeiten — correct word order)" },
  { level: "B1", prompt: "Fill in: Das ist der Mann, ___ mir geholfen hat. (relative pronoun)" },
  { level: "B1", prompt: "Rewrite in passive: Man baut ein neues Haus. → ___" },
  { level: "B2", prompt: "Fill in with Konjunktiv I: Er sagt, er ___ keine Zeit. (haben)" },
  { level: "B2", prompt: "Use je...desto: More I practice, better I become. → ___" },
  { level: "C1", prompt: "Rewrite formally using Funktionsverbgefüge: 'Man muss das berücksichtigen.' → Man muss das in ___ ___." },
  { level: "C1", prompt: "Add a modal particle to make this friendlier: 'Komm mit!' → ___" },
];

export async function GET() {
  return NextResponse.json({
    prompts: PLACEMENT_PROMPTS.map((p, i) => ({
      index: i,
      level: p.level,
      prompt: p.prompt,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const { answers } = await request.json();

    if (!answers || !Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json({ error: "Missing answers array" }, { status: 400 });
    }

    // Score each answer via Claude
    const scoredAnswers = [];
    for (const answer of answers) {
      const prompt = PLACEMENT_PROMPTS[answer.index];
      if (!prompt) continue;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 256,
        system: `You are evaluating a German grammar placement test answer.
Level: ${prompt.level}
Prompt: "${prompt.prompt}"

Return ONLY valid JSON:
{"score": number 0-100, "correct": true/false, "feedback": "brief feedback"}`,
        messages: [{ role: "user", content: `Answer: "${answer.response}"` }],
      });

      const content = message.content[0];
      if (content.type === "text") {
        const result = JSON.parse(content.text);
        scoredAnswers.push({
          ...answer,
          level: prompt.level,
          prompt: prompt.prompt,
          score: result.score,
          correct: result.correct,
          feedback: result.feedback,
        });
      }
    }

    // Determine level: highest level where user scores >= 60% on both questions
    const levels: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
    let assignedLevel: CefrLevel = "A1";

    for (const level of levels) {
      const levelAnswers = scoredAnswers.filter((a) => a.level === level);
      if (levelAnswers.length === 0) break;
      const avgScore = levelAnswers.reduce((sum, a) => sum + a.score, 0) / levelAnswers.length;
      if (avgScore >= 60) {
        assignedLevel = level;
      } else {
        break;
      }
    }

    const totalScore = Math.round(
      scoredAnswers.reduce((sum, a) => sum + a.score, 0) / scoredAnswers.length
    );

    return NextResponse.json({
      assignedLevel,
      totalScore,
      answers: scoredAnswers,
    });
  } catch (error) {
    console.error("Placement test error:", error);
    return NextResponse.json({ error: "Failed to evaluate placement test" }, { status: 500 });
  }
}
