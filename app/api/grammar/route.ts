import { NextRequest, NextResponse } from "next/server";
import { analyzeGrammarFull } from "@/lib/anthropic";
import { supabase } from "@/lib/supabase";

interface GrammarRequestBody {
  sentence: string;
  topic?: string;
  nativeLanguage: string;
  userId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: GrammarRequestBody = await request.json();
    const { sentence, topic, nativeLanguage, userId } = body;

    if (!sentence || !nativeLanguage) {
      return NextResponse.json(
        { error: "Missing required fields: sentence, nativeLanguage" },
        { status: 400 }
      );
    }

    const analysis = await analyzeGrammarFull(sentence, topic ?? null, nativeLanguage);

    // Persist to Supabase if userId is provided
    if (userId) {
      const detectedTopic = topic ?? analysis.errorTypes[0] ?? "general";

      const { error: attemptError } = await supabase
        .from("attempts")
        .insert({
          user_id: userId,
          sentence,
          topic: detectedTopic,
          score: analysis.score,
          error_types: analysis.errorTypes,
        });

      if (attemptError) {
        console.error("Failed to insert attempt:", attemptError);
      }

      const mistakeRows = analysis.tokens
        .filter((t) => t.status === "warn" || t.status === "wrong")
        .map((t) => ({
          user_id: userId,
          error_type: analysis.errorTypes[0] ?? t.status,
          word: t.word,
          correction: t.correction ?? null,
          topic: detectedTopic,
        }));

      if (mistakeRows.length > 0) {
        const { error: mistakeError } = await supabase
          .from("mistakes")
          .insert(mistakeRows);

        if (mistakeError) {
          console.error("Failed to insert mistakes:", mistakeError);
        }
      }
    }

    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Grammar analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze grammar" },
      { status: 500 }
    );
  }
}
