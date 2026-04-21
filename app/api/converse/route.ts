import { NextRequest, NextResponse } from "next/server";
import { streamAnalyzeForConversation, LearnerContext } from "@/lib/anthropic";
import {
  processUserTurn,
  createLearnerModel,
  createConversationState,
  getSessionOpener,
} from "@/lib/conversationEngine";
import { LearnerModel, ConversationState } from "@/types";

// Streaming Claude responses can take 10+ seconds for complex learners.
// Clamped to 10s on hobby, honored up to 60s on Vercel Pro.
export const maxDuration = 60;

/**
 * POST /api/converse
 *
 * Streaming ACL endpoint. Returns newline-delimited JSON events:
 *   {"type":"token","text":"..."}       — coach message chunks (stream immediately)
 *   {"type":"coachDone","text":"..."}   — full coach message (trigger TTS)
 *   {"type":"analysis","data":{...}}    — full engine output (corrections, score, etc.)
 */

interface ConverseRequestBody {
  sentence: string;
  learnerModel: LearnerModel;
  conversationState: ConversationState;
  persistentErrors?: string[];
  sessionFocus?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: ConverseRequestBody = await request.json();
    const { sentence, learnerModel, conversationState, persistentErrors, sessionFocus } = body;

    if (!sentence) {
      return NextResponse.json(
        { error: "Missing required field: sentence" },
        { status: 400 }
      );
    }

    // Build conversation context from recent turns
    const recentTurns = conversationState.turns.slice(-6);
    const contextStr = recentTurns
      .map((t) => `${t.role === "user" ? "User" : "Coach"}: ${t.text}`)
      .join("\n");

    // Build learner context
    const improving = learnerModel.structures
      .filter((s) => s.lastCorrect && s.mastery > 0.3)
      .map((s) => s.name);
    const struggling = learnerModel.structures
      .filter((s) => s.mastery < 0.4 && s.attempts > 0)
      .map((s) => s.name);
    const recentErrors = learnerModel.errorPatterns
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
      .slice(0, 3)
      .map((e) => `${e.example} → ${e.correction}`);

    // Detect inline language switch
    const langSwitchMatch = sentence.match(
      /(?:answer|respond|reply|speak|explain)\s+(?:in|auf|en)\s+(\w+)/i
    ) ?? sentence.match(
      /(\w+)\s+(?:te|de|mein|bolte|bolo|dilinde|sprache)/i
    );

    let coachLanguage = learnerModel.coachLanguage ?? learnerModel.nativeLanguage;
    if (langSwitchMatch) {
      coachLanguage = langSwitchMatch[1];
    }

    // Resolve focus structure name for drilling context
    let focusDrilling: string | undefined;
    if (conversationState.focusStructure && conversationState.focusRemaining > 0) {
      const { getStructureById } = await import("@/lib/grammarStructures");
      const focusDef = getStructureById(conversationState.focusStructure);
      focusDrilling = focusDef?.name ?? conversationState.focusStructure;
    }

    const learnerContext: LearnerContext = {
      nativeLanguage: learnerModel.nativeLanguage,
      coachLanguage,
      sessionCount: learnerModel.sessionCount,
      totalTurns: learnerModel.totalTurns,
      detectedLevel: learnerModel.detectedLevel,
      improving,
      struggling,
      recentErrors,
      focusDrilling,
      persistentErrors,
      sessionFocus,
    };

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const gen = streamAnalyzeForConversation(
            sentence,
            learnerModel.nativeLanguage,
            conversationState.currentTarget,
            contextStr,
            learnerContext
          );

          for await (const event of gen) {
            if (event.type === "token") {
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "token", text: event.text }) + "\n")
              );
            } else if (event.type === "coachDone") {
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "coachDone", text: event.text }) + "\n")
              );
            } else if (event.type === "analysis") {
              // Run the conversation engine with the full analysis
              const output = processUserTurn({
                userSentence: sentence,
                learnerModel,
                conversationState,
                analysisFromAPI: event.data,
              });

              controller.enqueue(
                encoder.encode(JSON.stringify({
                  type: "analysis",
                  data: {
                    responseText: output.responseText,
                    corrections: output.corrections,
                    ruleCard: output.ruleCard,
                    nextPrompt: output.nextPrompt,
                    score: output.score,
                    detectedLevel: output.detectedLevel,
                    tokens: output.tokens,
                    updatedModel: output.updatedModel,
                    updatedState: output.updatedState,
                    lessonSuggestion: output.lessonSuggestion,
                    activeRule: output.activeRule,
                    deepPracticeNudge: output.deepPracticeNudge,
                  },
                }) + "\n")
              );
            }
          }
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error("Streaming error:", errMsg);
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", message: errMsg }) + "\n")
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Conversation engine error:", errMsg);
    return NextResponse.json(
      { error: "Failed to process conversation", details: errMsg },
      { status: 500 }
    );
  }
}

/**
 * GET /api/converse?action=init&lang=English
 *
 * Initialize a new learner model and get the session opener.
 */
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  const lang = request.nextUrl.searchParams.get("lang") ?? "English";

  if (action === "init") {
    const model = createLearnerModel(lang);
    const state = createConversationState();
    const opener = getSessionOpener(model);

    return NextResponse.json({
      learnerModel: model,
      conversationState: state,
      opener,
    });
  }

  if (action === "resume") {
    const model = createLearnerModel(lang);
    const opener = getSessionOpener(model);

    return NextResponse.json({
      opener,
      learnerModel: model,
      conversationState: createConversationState(),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
