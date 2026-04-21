import { analyzeForConversation, LearnerContext } from "./anthropic";
import {
  processUserTurn,
  getSessionOpener,
  APIAnalysisResult,
  DisplayCorrection,
  RuleCardData,
  ActiveRule,
  DeepPracticeNudge,
  LessonSuggestion,
} from "./conversationEngine";
import { getStructureById } from "./grammarStructures";
import { getDueItems } from "./spacedRepetition";
import { LearnerModel, ConversationState, Token, CefrLevel } from "@/types";

/**
 * Rich per-turn analysis the voice UI renders.
 * Parallel to what the text chat's /api/converse streams back.
 * The Realtime model itself never sees this — only the UI does.
 */
export interface VoiceTurnAnalysis {
  sentence: string;
  responseText: string;
  score: number;
  detectedLevel: CefrLevel;
  tokens: Token[];
  corrections: DisplayCorrection[];
  ruleCard: RuleCardData | null;
  activeRule: ActiveRule | null;
  deepPracticeNudge: DeepPracticeNudge | null;
  lessonSuggestion: LessonSuggestion | null;
  nextPrompt: string;
  focusStructure: string | null;
  /** Structure IDs the learner made errors on this turn. Used by the voice UI
   *  to compute session-scoped error counts — so the handoff CTA waits until
   *  the learner has actually struggled in THIS conversation, not just lifetime. */
  errorStructureIds: string[];
}

// ── Tool Schemas (sent to OpenAI Realtime session config) ──

export const REALTIME_TOOLS = [
  {
    type: "function" as const,
    name: "analyze_german_sentence",
    description:
      "Analyze a German sentence spoken by the learner. Call this EVERY TIME the learner says something in German. Returns grammar corrections, a coaching message, and a nextPrompt suggestion. Rules: (1) Speak ONLY the coachMessage — keep it to 1–2 sentences. (2) NEVER read the nextPrompt aloud — it is for the UI only. (3) After the coachMessage, STOP. Do not chain a follow-up question. The learner needs silent time to read and absorb. (4) Do not invent grammar corrections — trust the tool. (5) Do not suggest switching to a separate lesson — the app's UI handles that silently.",
    parameters: {
      type: "object",
      properties: {
        sentence: {
          type: "string",
          description: "The German sentence the learner said",
        },
      },
      required: ["sentence"],
    },
  },
  {
    type: "function" as const,
    name: "get_session_context",
    description:
      "Get the learner's current level, weak areas, and a session opener message. Call this once at the start of the conversation.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

// ── Tool Execution (runs server-side) ──

export interface ToolExecutionInput {
  toolName: string;
  args: Record<string, unknown>;
  learnerModel: LearnerModel;
  conversationState: ConversationState;
  /** Structure IDs the learner dismissed a handoff offer for in this voice
   *  session. Suppresses offerDeepPractice so the coach stops bringing it up. */
  dismissedNudges?: string[];
}

export interface ToolExecutionResult {
  result: string; // JSON string to send back to Realtime API
  updatedModel?: LearnerModel;
  updatedState?: ConversationState;
  /** Full analysis for the voice UI to render (not sent to the Realtime model). */
  turnAnalysis?: VoiceTurnAnalysis;
}

export async function executeTool(
  input: ToolExecutionInput
): Promise<ToolExecutionResult> {
  const { toolName, args, learnerModel, conversationState, dismissedNudges } = input;

  switch (toolName) {
    case "analyze_german_sentence":
      return executeAnalyze(
        args.sentence as string,
        learnerModel,
        conversationState,
        dismissedNudges ?? []
      );

    case "get_session_context":
      return executeGetContext(learnerModel);

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
  }
}

// ── analyze_german_sentence ──

async function executeAnalyze(
  sentence: string,
  learnerModel: LearnerModel,
  conversationState: ConversationState,
  dismissedNudges: string[]
): Promise<ToolExecutionResult> {
  // Build conversation context from recent turns
  const recentTurns = conversationState.turns.slice(-6);
  const contextStr = recentTurns
    .map((t) => `${t.role === "user" ? "User" : "Coach"}: ${t.text}`)
    .join("\n");

  // Build learner context for Claude
  const improving = learnerModel.structures
    .filter((s) => s.lastCorrect && s.mastery > 0.3)
    .map((s) => s.name);
  const struggling = learnerModel.structures
    .filter((s) => s.mastery < 0.4 && s.attempts > 0)
    .map((s) => s.name);
  const recentErrors = learnerModel.errorPatterns
    .sort(
      (a, b) =>
        new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
    )
    .slice(0, 3)
    .map((e) => `${e.example} → ${e.correction}`);

  let focusDrilling: string | undefined;
  if (
    conversationState.focusStructure &&
    conversationState.focusRemaining > 0
  ) {
    const focusDef = getStructureById(conversationState.focusStructure);
    focusDrilling = focusDef?.name ?? conversationState.focusStructure;
  }

  const learnerContext: LearnerContext = {
    nativeLanguage: learnerModel.nativeLanguage,
    coachLanguage: learnerModel.coachLanguage ?? learnerModel.nativeLanguage,
    sessionCount: learnerModel.sessionCount,
    totalTurns: learnerModel.totalTurns,
    detectedLevel: learnerModel.detectedLevel,
    improving,
    struggling,
    recentErrors,
    focusDrilling,
  };

  // Call Claude for grammar analysis
  const analysis: APIAnalysisResult = await analyzeForConversation(
    sentence,
    learnerModel.nativeLanguage,
    conversationState.currentTarget,
    contextStr,
    learnerContext
  );

  // Run ACL engine to update learner model
  const output = processUserTurn({
    userSentence: sentence,
    learnerModel,
    conversationState,
    analysisFromAPI: analysis,
  });

  // Build a concise result for the Realtime model to speak.
  // Only send what GPT-4o needs to formulate its response.
  // NOTE: we intentionally do NOT send any "offer a separate lesson" signal.
  // Surfacing dedicated lessons is handled by the UI as a silent inline chip
  // plus a client-side verbal drill cue (see page.tsx announcedDrillsRef) —
  // the voice coach should never verbally push the learner out of the chat.
  const toolResult = {
    coachMessage: output.responseText,
    corrections: output.corrections.map((c) => ({
      original: c.original,
      correction: c.correction,
    })),
    score: output.score,
    nextPrompt: output.nextPrompt,
    detectedLevel: output.detectedLevel,
    focusArea: output.activeRule?.structureName ?? null,
    errorCount: output.activeRule?.errorCount ?? 0,
  };

  const turnAnalysis: VoiceTurnAnalysis = {
    sentence,
    responseText: output.responseText,
    score: output.score,
    detectedLevel: output.detectedLevel,
    tokens: output.tokens as Token[],
    corrections: output.corrections,
    ruleCard: output.ruleCard,
    activeRule: output.activeRule,
    deepPracticeNudge: output.deepPracticeNudge,
    lessonSuggestion: output.lessonSuggestion,
    nextPrompt: output.nextPrompt,
    focusStructure: output.updatedState.focusStructure ?? null,
    errorStructureIds: analysis.errors.map((e) => e.structureId),
  };

  return {
    result: JSON.stringify(toolResult),
    updatedModel: output.updatedModel,
    updatedState: output.updatedState,
    turnAnalysis,
  };
}

// ── get_session_context ──

function executeGetContext(
  learnerModel: LearnerModel
): ToolExecutionResult {
  const opener = getSessionOpener(learnerModel);
  const weak = learnerModel.structures
    .filter((s) => s.mastery < 0.4 && s.attempts > 0)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 3)
    .map((s) => s.name);

  const dueItems = getDueItems(
    learnerModel.spacedRepetitionQueue,
    learnerModel.totalTurns
  );
  const dueTopics = dueItems
    .slice(0, 3)
    .map((item) => {
      const def = getStructureById(item.structureId);
      return def?.name ?? item.structureId;
    });

  const toolResult = {
    opener,
    level: learnerModel.detectedLevel,
    nativeLanguage: learnerModel.nativeLanguage,
    coachLanguage: learnerModel.coachLanguage ?? learnerModel.nativeLanguage,
    sessionCount: learnerModel.sessionCount,
    weakAreas: weak,
    dueForReview: dueTopics,
  };

  return { result: JSON.stringify(toolResult) };
}
