import { NextRequest, NextResponse } from "next/server";
import { executeTool } from "@/lib/realtimeTools";
import { LearnerModel, ConversationState } from "@/types";

// Give Claude analysis plenty of room before Vercel kills the request.
// On hobby this is clamped to 10s; on Pro we get the full 60s.
export const maxDuration = 60;

/**
 * POST /api/realtime/tool
 *
 * Executes a tool call from the OpenAI Realtime session.
 * The client receives the tool call via DataChannel, POSTs here,
 * gets the result, and sends it back to the Realtime API.
 *
 * Input: {
 *   toolName: string,
 *   args: object,
 *   learnerModel: LearnerModel,
 *   conversationState: ConversationState
 * }
 *
 * Output: {
 *   result: string (JSON),
 *   updatedModel?: LearnerModel,
 *   updatedState?: ConversationState
 * }
 *
 * Privacy: learnerModel + conversationState come from the client's
 * React state and are processed server-side only. The result string
 * sent back to the Realtime API contains only corrections and
 * coaching text — not the full learner profile.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { toolName, args, learnerModel, conversationState, dismissedNudges } = body as {
      toolName: string;
      args: Record<string, unknown>;
      learnerModel: LearnerModel;
      conversationState: ConversationState;
      dismissedNudges?: string[];
    };

    if (!toolName) {
      return NextResponse.json(
        { error: "Missing toolName" },
        { status: 400 }
      );
    }

    const result = await executeTool({
      toolName,
      args: args ?? {},
      learnerModel,
      conversationState,
      dismissedNudges,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Tool execution error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Tool execution failed", details: errMsg },
      { status: 500 }
    );
  }
}
