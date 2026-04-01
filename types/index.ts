// ── CEFR & Curriculum ──

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type LessonStatus = "locked" | "available" | "in_progress" | "completed";

export type LessonPhase = "teach" | "drill" | "write" | "review";

export interface CurriculumLesson {
  id: string;
  cefrLevel: CefrLevel;
  order: number;
  title: string;
  slug: string;
  description: string;
  grammarFocus: string;
  prerequisites: string[];
  teachContent: string;
  drillPrompts: string[];
  writePrompt: string;
  passingScore: number;
}

export interface UserLessonProgress {
  id: string;
  userId: string;
  lessonId: string;
  status: LessonStatus;
  phase: LessonPhase;
  drillScore: number | null;
  writeScore: number | null;
  completedAt: string | null;
}

export interface PlacementAnswer {
  prompt: string;
  response: string;
  score: number;
  level: CefrLevel;
}

export interface PlacementResult {
  id: string;
  userId: string;
  assignedLevel: CefrLevel;
  answers: PlacementAnswer[];
  totalScore: number;
  createdAt: string;
}

// ── Grammar Analysis ──

export interface Token {
  word: string;
  status: "correct" | "wrong" | "warn" | "tip";
  correction?: string;
  rule?: string;
}

export interface GrammarAnalysis {
  tokens: Token[];
  score: number;
  errorTypes: string[];
  coachMessage: string;
}

export interface AnalyzeGrammarRequest {
  sentence: string;
  topic: string;
  nativeLanguage: string;
  userId?: string;
}

// ── User & Session ──

export interface UserProfile {
  id: string;
  email: string;
  nativeLanguage: string;
  cefrLevel: CefrLevel | null;
  level: number;
  xp: number;
  streak: number;
  tier: "free" | "pro";
  tokensUsed: number;
}

export interface SessionData {
  id: string;
  userId: string;
  sentences: string[];
  analyses: GrammarAnalysis[];
  createdAt: string;
}

// Extended analysis with level detection (returned by "Just Talk" mode)
export interface AnalysisWithLevel extends GrammarAnalysis {
  detectedLevel: CefrLevel;
  nextPrompt: string;
}

// ── Adaptive Conversational Loop (ACL) ──

export type CorrectionLevel = "recast" | "highlight" | "explicit";

export interface GrammarStructure {
  id: string;                    // e.g. "dativ_prepositions", "akkusativ_articles"
  name: string;                  // human-readable: "Dativ after prepositions"
  cefrLevel: CefrLevel;
  mastery: number;               // 0.0 – 1.0
  attempts: number;
  lastSeen: string | null;       // ISO date
  lastCorrect: boolean | null;
}

export interface ErrorPattern {
  id: string;
  structureId: string;           // links to GrammarStructure
  pattern: string;               // e.g. "mit + Nominativ instead of Dativ"
  example: string;               // "Ich gehe mit mein Freund"
  correction: string;            // "Ich gehe mit meinem Freund"
  count: number;
  correctionLevel: CorrectionLevel;  // current escalation level
  lastSeen: string;
}

export interface SpacedRepetitionItem {
  id: string;
  structureId: string;
  dueAt: string;                 // ISO date — when to re-test
  interval: number;              // current interval in turns (1, 3, 8, 20, ...)
  easeFactor: number;            // SM-2 style ease factor
  repetitions: number;
}

export interface LearnerModel {
  id: string;
  nativeLanguage: string;
  coachLanguage: string;            // language the coach responds in (e.g. "English", "Bengali", "German")
  detectedLevel: CefrLevel;
  structures: GrammarStructure[];
  errorPatterns: ErrorPattern[];
  spacedRepetitionQueue: SpacedRepetitionItem[];
  sessionCount: number;
  totalTurns: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationTurn {
  role: "user" | "coach";
  text: string;
  analysis?: TurnAnalysis;
  timestamp: string;
}

export interface TurnAnalysis {
  structuresUsed: string[];       // structure IDs detected in user's sentence
  errors: TurnError[];
  detectedLevel: CefrLevel;
  score: number;
}

export interface TurnError {
  structureId: string;
  original: string;
  correction: string;
  rule: string;
  correctionLevel: CorrectionLevel;  // what level of feedback to give
}

export interface ConversationState {
  turns: ConversationTurn[];
  currentTarget: string | null;     // structure ID being targeted
  turnsSinceLastCorrection: number;
  sessionStructuresCovered: string[];
}
