import {
  LearnerModel,
  ConversationState,
  ConversationTurn,
  TurnAnalysis,
  TurnError,
  CorrectionLevel,
  GrammarStructure,
  ErrorPattern,
  CefrLevel,
} from "@/types";
import { getStructureById, getStructuresUpToLevel, GRAMMAR_STRUCTURES } from "./grammarStructures";
import { createSRSItem, updateSRSItem, getDueItems, assessQuality } from "./spacedRepetition";
import { getInlineSuggestion } from "./learningPath";

// ═══════════════════════════════════════════════════════════════
// ACL: Adaptive Conversational Loop
//
//   OBSERVE → DIAGNOSE → ENGAGE → CORRECT → REINFORCE → loop
//
// This engine is stateless — it takes the current learner model
// and conversation state, and returns:
//   1. The response to show the user
//   2. Updated learner model
//   3. Updated conversation state
// ═══════════════════════════════════════════════════════════════

export interface EngineInput {
  userSentence: string;
  learnerModel: LearnerModel;
  conversationState: ConversationState;
  analysisFromAPI: APIAnalysisResult;
}

export interface APIAnalysisResult {
  tokens: { word: string; status: string; correction?: string; rule?: string }[];
  score: number;
  errorTypes: string[];
  detectedLevel: CefrLevel;
  structuresUsed: string[];      // structure IDs
  errors: {
    structureId: string;
    original: string;
    correction: string;
    rule: string;
    ruleForL1?: string;          // rule explanation specific to learner's L1
  }[];
  coachMessage: string;
  nextPrompt: string;
}

export interface LessonSuggestion {
  message: string;
  lessonId: string;
}

export interface EngineOutput {
  responseText: string;
  corrections: DisplayCorrection[];
  ruleCard: RuleCardData | null;
  nextPrompt: string;
  score: number;
  detectedLevel: CefrLevel;
  updatedModel: LearnerModel;
  updatedState: ConversationState;
  tokens: APIAnalysisResult["tokens"];
  /** Inline lesson suggestion when a structure has repeated errors */
  lessonSuggestion: LessonSuggestion | null;
}

export interface DisplayCorrection {
  original: string;
  correction: string;
  level: CorrectionLevel;
}

export interface RuleCardData {
  structureName: string;
  rule: string;
  l1Comparison: string | null;
  example: string;
}

// ───────────────────────────────────────────────────────────────
// Main engine function
// ───────────────────────────────────────────────────────────────

export function processUserTurn(input: EngineInput): EngineOutput {
  const { userSentence, learnerModel, conversationState, analysisFromAPI } = input;
  const totalTurns = learnerModel.totalTurns + 1;

  // ── STEP 1: OBSERVE ──
  // Build turn analysis from API result
  const turnErrors: TurnError[] = analysisFromAPI.errors.map((e) => ({
    structureId: e.structureId,
    original: e.original,
    correction: e.correction,
    rule: e.rule,
    correctionLevel: determineCorrectionLevel(e.structureId, learnerModel),
  }));

  const turnAnalysis: TurnAnalysis = {
    structuresUsed: analysisFromAPI.structuresUsed,
    errors: turnErrors,
    detectedLevel: analysisFromAPI.detectedLevel,
    score: analysisFromAPI.score,
  };

  // ── STEP 2: DIAGNOSE ──
  // Update structures mastery based on what we observed
  let updatedStructures = [...learnerModel.structures];

  // Update mastery for structures that were used correctly
  for (const structId of analysisFromAPI.structuresUsed) {
    const errorOnThis = turnErrors.find((e) => e.structureId === structId);
    updatedStructures = updateStructureMastery(
      updatedStructures,
      structId,
      !errorOnThis,
      analysisFromAPI.detectedLevel
    );
  }

  // Update error patterns
  let updatedErrorPatterns = [...learnerModel.errorPatterns];
  for (const error of turnErrors) {
    updatedErrorPatterns = updateErrorPattern(
      updatedErrorPatterns,
      error
    );
  }

  // ── STEP 3: CORRECT ──
  // Generate response based on correction levels
  const corrections: DisplayCorrection[] = [];
  let ruleCard: RuleCardData | null = null;
  const responseParts: string[] = [];

  // Build the coach's response
  if (turnErrors.length === 0) {
    // No errors — positive reinforcement
    responseParts.push(analysisFromAPI.coachMessage);
  } else {
    // Process each error at the appropriate correction level
    for (const error of turnErrors) {
      const level = error.correctionLevel;
      corrections.push({
        original: error.original,
        correction: error.correction,
        level,
      });

      if (level === "explicit") {
        // Full rule card for repeated errors
        const structDef = getStructureById(error.structureId);
        const l1Key = learnerModel.nativeLanguage;
        ruleCard = {
          structureName: structDef?.name ?? error.structureId,
          rule: error.rule,
          l1Comparison: structDef?.l1Interference[l1Key] ?? null,
          example: `${error.original} → ${error.correction}`,
        };
      }
    }

    // Build natural response text based on correction strategy
    responseParts.push(buildCorrectionResponse(turnErrors, analysisFromAPI, learnerModel));
  }

  // ── STEP 4: REINFORCE ──
  // Update spaced repetition queue
  let updatedSRS = [...learnerModel.spacedRepetitionQueue];

  for (const error of turnErrors) {
    const existing = updatedSRS.find((s) => s.structureId === error.structureId);
    if (existing) {
      const quality = assessQuality(false, error.correctionLevel, false);
      const updated = updateSRSItem(existing, quality, totalTurns);
      updatedSRS = updatedSRS.map((s) => s.id === existing.id ? updated : s);
    } else {
      updatedSRS.push(createSRSItem(error.structureId));
    }
  }

  // Update SRS for correctly used structures
  for (const structId of analysisFromAPI.structuresUsed) {
    if (!turnErrors.find((e) => e.structureId === structId)) {
      const existing = updatedSRS.find((s) => s.structureId === structId);
      if (existing) {
        const quality = assessQuality(true, "recast", true);
        const updated = updateSRSItem(existing, quality, totalTurns);
        updatedSRS = updatedSRS.map((s) => s.id === existing.id ? updated : s);
      }
    }
  }

  // ── STEP 5: ENGAGE ──
  // Determine next prompt — prioritize SRS due items, then weak structures
  const nextPrompt = determineNextPrompt(
    updatedSRS,
    updatedStructures,
    conversationState,
    learnerModel,
    totalTurns,
    analysisFromAPI.nextPrompt
  );

  // Build updated learner model
  const updatedModel: LearnerModel = {
    ...learnerModel,
    structures: updatedStructures,
    errorPatterns: updatedErrorPatterns,
    spacedRepetitionQueue: updatedSRS,
    detectedLevel: analysisFromAPI.detectedLevel,
    totalTurns,
    updatedAt: new Date().toISOString(),
  };

  // Build updated conversation state
  const userTurn: ConversationTurn = {
    role: "user",
    text: userSentence,
    analysis: turnAnalysis,
    timestamp: new Date().toISOString(),
  };

  const coachTurn: ConversationTurn = {
    role: "coach",
    text: responseParts.join("\n\n"),
    timestamp: new Date().toISOString(),
  };

  const updatedState: ConversationState = {
    turns: [...conversationState.turns, userTurn, coachTurn],
    currentTarget: getTargetStructure(updatedSRS, updatedStructures, totalTurns),
    turnsSinceLastCorrection: turnErrors.length > 0 ? 0 : conversationState.turnsSinceLastCorrection + 1,
    sessionStructuresCovered: Array.from(
      new Set([...conversationState.sessionStructuresCovered, ...analysisFromAPI.structuresUsed])
    ),
  };

  // ── STEP 6: SUGGEST LESSON ──
  // If any error structure has 2+ occurrences, suggest a focused lesson
  let lessonSuggestion: LessonSuggestion | null = null;
  for (const error of turnErrors) {
    const suggestion = getInlineSuggestion(updatedModel, error.structureId);
    if (suggestion) {
      lessonSuggestion = suggestion;
      break; // one suggestion per turn
    }
  }

  return {
    responseText: responseParts.join("\n\n"),
    corrections,
    ruleCard,
    nextPrompt,
    score: analysisFromAPI.score,
    detectedLevel: analysisFromAPI.detectedLevel,
    tokens: analysisFromAPI.tokens,
    updatedModel,
    updatedState,
    lessonSuggestion,
  };
}

// ───────────────────────────────────────────────────────────────
// Helper: Determine correction level based on error history
// ───────────────────────────────────────────────────────────────

function determineCorrectionLevel(
  structureId: string,
  model: LearnerModel
): CorrectionLevel {
  const pattern = model.errorPatterns.find((p) => p.structureId === structureId);
  if (!pattern) return "recast";        // first time — be subtle
  if (pattern.count === 1) return "recast";
  if (pattern.count === 2) return "highlight";
  return "explicit";                      // 3+ times — full explanation
}

// ───────────────────────────────────────────────────────────────
// Helper: Update structure mastery (exponential moving average)
// ───────────────────────────────────────────────────────────────

function updateStructureMastery(
  structures: GrammarStructure[],
  structureId: string,
  wasCorrect: boolean,
  detectedLevel: CefrLevel
): GrammarStructure[] {
  const existing = structures.find((s) => s.id === structureId);
  const alpha = 0.3; // learning rate — higher = more responsive to recent performance

  if (existing) {
    const newMastery = existing.mastery * (1 - alpha) + (wasCorrect ? 1 : 0) * alpha;
    return structures.map((s) =>
      s.id === structureId
        ? {
            ...s,
            mastery: Math.round(newMastery * 100) / 100,
            attempts: s.attempts + 1,
            lastSeen: new Date().toISOString(),
            lastCorrect: wasCorrect,
          }
        : s
    );
  }

  // New structure — initialize
  const structDef = getStructureById(structureId);
  return [
    ...structures,
    {
      id: structureId,
      name: structDef?.name ?? structureId,
      cefrLevel: structDef?.cefrLevel ?? detectedLevel,
      mastery: wasCorrect ? 0.7 : 0.2, // first impression
      attempts: 1,
      lastSeen: new Date().toISOString(),
      lastCorrect: wasCorrect,
    },
  ];
}

// ───────────────────────────────────────────────────────────────
// Helper: Update error patterns (escalation tracking)
// ───────────────────────────────────────────────────────────────

function updateErrorPattern(
  patterns: ErrorPattern[],
  error: TurnError
): ErrorPattern[] {
  const existing = patterns.find((p) => p.structureId === error.structureId);

  if (existing) {
    return patterns.map((p) =>
      p.structureId === error.structureId
        ? {
            ...p,
            count: p.count + 1,
            example: error.original,
            correction: error.correction,
            correctionLevel: error.correctionLevel,
            lastSeen: new Date().toISOString(),
          }
        : p
    );
  }

  return [
    ...patterns,
    {
      id: `err_${error.structureId}_${Date.now()}`,
      structureId: error.structureId,
      pattern: `${error.original} → ${error.correction}`,
      example: error.original,
      correction: error.correction,
      count: 1,
      correctionLevel: "recast",
      lastSeen: new Date().toISOString(),
    },
  ];
}

// ───────────────────────────────────────────────────────────────
// Helper: Build natural correction response
// ───────────────────────────────────────────────────────────────

function buildCorrectionResponse(
  errors: TurnError[],
  analysis: APIAnalysisResult,
  model: LearnerModel
): string {
  // Always lead with Claude's warm, conversational message
  // It already responds to meaning first, then folds in corrections
  const parts: string[] = [analysis.coachMessage];

  // Only add mechanical correction notes for highlight/explicit level
  // Recasts are already handled naturally in the coachMessage
  const highlights = errors.filter((e) => e.correctionLevel === "highlight");
  const explicits = errors.filter((e) => e.correctionLevel === "explicit");

  // Highlights — gentle nudge (second time seeing this error)
  for (const h of highlights) {
    parts.push(`**${h.original}** → **${h.correction}** — ${h.rule}`);
  }

  // Explicits — full explanation (3+ times, they need the rule)
  for (const e of explicits) {
    const structDef = getStructureById(e.structureId);
    const l1Note = structDef?.l1Interference[model.nativeLanguage];
    let msg = `**${e.original}** → **${e.correction}**. ${e.rule}`;
    if (l1Note) {
      msg += `\n${l1Note}`;
    }
    parts.push(msg);
  }

  return parts.join("\n\n");
}

// ───────────────────────────────────────────────────────────────
// Helper: Determine next prompt (conversation steering)
// ───────────────────────────────────────────────────────────────

function determineNextPrompt(
  srsQueue: LearnerModel["spacedRepetitionQueue"],
  structures: GrammarStructure[],
  state: ConversationState,
  model: LearnerModel,
  currentTurn: number,
  fallbackPrompt: string
): string {
  // Prefer Claude's AI-generated prompt — it's context-aware and feels natural.
  // Only fall back to hardcoded prompts when the AI prompt is empty or for
  // the very first encounter with a structure (where we need a guaranteed elicitor).

  // 1. Check SRS queue for due items
  const dueItems = getDueItems(srsQueue, currentTurn);
  if (dueItems.length > 0) {
    const targetStructure = getStructureById(dueItems[0].structureId);
    if (targetStructure) {
      // Use AI prompt most of the time — it already knows the target structure
      // and generates varied, conversational questions
      if (fallbackPrompt && fallbackPrompt.trim()) {
        return fallbackPrompt;
      }
      // AI prompt empty — use hardcoded as safety net
      const prompts = targetStructure.elicitingPrompts;
      const unused = prompts.filter(
        (p) => !state.turns.some((t) => t.text === p)
      );
      return unused.length > 0
        ? unused[Math.floor(Math.random() * unused.length)]
        : prompts[Math.floor(Math.random() * prompts.length)];
    }
  }

  // 2. Target weakest known structure — same logic, prefer AI prompt
  const weakest = structures
    .filter((s) => s.attempts > 0 && s.mastery < 0.6)
    .sort((a, b) => a.mastery - b.mastery)[0];

  if (weakest) {
    if (fallbackPrompt && fallbackPrompt.trim()) {
      return fallbackPrompt;
    }
    const structDef = getStructureById(weakest.id);
    if (structDef) {
      const prompts = structDef.elicitingPrompts;
      const unused = prompts.filter(
        (p) => !state.turns.some((t) => t.text === p)
      );
      return unused.length > 0
        ? unused[Math.floor(Math.random() * unused.length)]
        : prompts[Math.floor(Math.random() * prompts.length)];
    }
  }

  // 3. Introduce something new at i+1 (one level above comfort)
  const levelOrder: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const currentLevelIdx = levelOrder.indexOf(model.detectedLevel);
  const targetLevel = levelOrder[Math.min(currentLevelIdx + 1, levelOrder.length - 1)];

  const newStructures = GRAMMAR_STRUCTURES.filter(
    (s) => s.cefrLevel === targetLevel && !structures.find((known) => known.id === s.id)
  );

  if (newStructures.length > 0) {
    // For first encounter, use hardcoded prompt to guarantee the structure is elicited
    const target = newStructures[0];
    const prompts = target.elicitingPrompts;
    return prompts[Math.floor(Math.random() * prompts.length)];
  }

  // 4. Fallback to AI-generated prompt
  return fallbackPrompt;
}

function getTargetStructure(
  srsQueue: LearnerModel["spacedRepetitionQueue"],
  structures: GrammarStructure[],
  currentTurn: number
): string | null {
  const dueItems = getDueItems(srsQueue, currentTurn);
  if (dueItems.length > 0) return dueItems[0].structureId;

  const weakest = structures
    .filter((s) => s.attempts > 0 && s.mastery < 0.6)
    .sort((a, b) => a.mastery - b.mastery)[0];

  return weakest?.id ?? null;
}

// ───────────────────────────────────────────────────────────────
// Initialize a new learner model
// ───────────────────────────────────────────────────────────────

export function createLearnerModel(nativeLanguage: string): LearnerModel {
  return {
    id: `learner_${Date.now()}`,
    nativeLanguage,
    coachLanguage: nativeLanguage,    // default: respond in the user's native language
    detectedLevel: "A1",
    structures: [],
    errorPatterns: [],
    spacedRepetitionQueue: [],
    sessionCount: 0,
    totalTurns: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────
// Initialize conversation state
// ───────────────────────────────────────────────────────────────

export function createConversationState(): ConversationState {
  return {
    turns: [],
    currentTarget: null,
    turnsSinceLastCorrection: 0,
    sessionStructuresCovered: [],
  };
}

// ───────────────────────────────────────────────────────────────
// Generate the opening prompt for a new session
// ───────────────────────────────────────────────────────────────

export function getSessionOpener(model: LearnerModel): string {
  // First session ever — warm welcome
  if (model.sessionCount === 0) {
    return "Hey! Just say anything in German — even one word is totally fine. There's no wrong answer here, I just want to hear where you're at. We'll figure out the rest together.";
  }

  // Second session — acknowledge they came back
  if (model.sessionCount === 1) {
    return "Hey, welcome back! Last time went well. Ready to pick up where we left off? Just write whatever comes to mind in German.";
  }

  // Returning user — personalize based on their journey
  const improving = model.structures
    .filter((s) => s.lastCorrect && s.mastery > 0.5)
    .map((s) => s.name);
  const weak = model.structures
    .filter((s) => s.mastery < 0.4 && s.attempts > 0)
    .sort((a, b) => a.mastery - b.mastery);

  // If there are due SRS items, weave them into a natural prompt
  const dueItems = getDueItems(model.spacedRepetitionQueue, model.totalTurns);
  if (dueItems.length > 0) {
    const target = getStructureById(dueItems[0].structureId);
    if (target) {
      const prompts = target.elicitingPrompts;
      const prompt = prompts[Math.floor(Math.random() * prompts.length)];
      // Wrap the eliciting prompt in a warm conversational frame
      const warmFrames = [
        `Good to see you again! Let's ease in — ${prompt}`,
        `Hey! Quick question to get us started: ${prompt}`,
        `Welcome back! Here's something fun to try: ${prompt}`,
      ];
      return warmFrames[Math.floor(Math.random() * warmFrames.length)];
    }
  }

  // Acknowledge improvement if any
  if (improving.length > 0 && weak.length > 0) {
    const warmOpeners = [
      `Hey! Your ${improving[0]} has been getting really solid. Let's keep that going — tell me something about your day in German.`,
      `Welcome back! I noticed you're getting more comfortable with German. What's on your mind today? Just say it in German, however it comes out.`,
    ];
    return warmOpeners[Math.floor(Math.random() * warmOpeners.length)];
  }

  // General warm openers by level
  const levelPrompts: Record<CefrLevel, string[]> = {
    A1: [
      "Hey! Tell me something simple about today — what did you eat, or how are you feeling? In German, however it comes out.",
      "Welcome back! What's something you like? Food, a hobby, anything — try it in German.",
    ],
    A2: [
      "Hey! What did you get up to recently? Tell me in German — doesn't have to be perfect.",
      "Good to see you! If you could do anything this weekend, what would it be? Try telling me in German.",
    ],
    B1: [
      "Hey! Tell me something interesting that happened to you lately. In German, take your time.",
      "Welcome back! I'm curious — what's something you've been thinking about recently? Let's talk about it in German.",
    ],
    B2: [
      "Hey! I'm curious about your take on something — what's an opinion you hold that most people disagree with? Tell me in German.",
      "Welcome back! Tell me about something you read or watched recently that stuck with you. In German, of course.",
    ],
    C1: [
      "Hey! Here's a fun one — if you could change one thing about how people communicate, what would it be? Tell me in German.",
      "Welcome back! What's something about German culture or language that still surprises you? Let's dive in.",
    ],
    C2: [
      "Hey! Let's go deep today — tell me about an idea that changed how you see the world. In German, take all the time you need.",
      "Welcome back! What's the most interesting thing you've learned recently? Let's discuss it in German.",
    ],
  };

  const prompts = levelPrompts[model.detectedLevel];
  return prompts[Math.floor(Math.random() * prompts.length)];
}
