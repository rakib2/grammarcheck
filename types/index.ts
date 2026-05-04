// ── CEFR & Curriculum ──

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export type LessonStatus = "locked" | "available" | "in_progress" | "completed";

/**
 * Phases a curriculum lesson cycles through.
 *
 *  teach     — markdown content + reference card (already has it)
 *  drill     — fill-in-the-blank prompts (already has it)
 *  translate — translate English → German with progressively-fading hints
 *  story     — scenario-based production requiring the target structure
 *  write     — open-ended sentence writing (already has it)
 *  error_spot — find/fix a sentence containing the learner's actual past
 *               mistake against this structure. Conditionally inserted only
 *               when learnerModel.errorPatterns has a match for the lesson.
 *  review    — final summary + score (already has it)
 */
export type LessonPhase =
  | "teach"
  | "drill"
  | "translate"
  | "story"
  | "write"
  | "error_spot"
  | "review";

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

export interface TranslationIssue {
  original: string;
  correction: string;
  explanation: string;
  severity: "minor" | "major";
}

export interface TranslationEvalResult {
  score: number;
  correct: boolean;
  feedback: string;
  correctAnswer: string;
  issues: TranslationIssue[];
  nextStep: string;
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
  /**
   * Language the learner is studying. ISO 639-1 code (e.g. "de", "es", "fr").
   * Loads the matching curriculum, structure list, and tutor prompt template
   * from lib/languages. Defaults to "de" for legacy learner models.
   */
  targetLanguage: string;
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
  /** When the learner makes an error, we drill the same grammar topic for a few turns */
  focusStructure: string | null;    // structure ID to keep drilling
  focusRemaining: number;           // turns left before moving on (0 = no focus)
}

// ── Vocabulary ──

export type VocabularyPos =
  | "noun"
  | "verb"
  | "adjective"
  | "adverb"
  | "preposition"
  | "particle"
  | "phrase";

/**
 * One entry in the learner's personal vocabulary deck.
 *
 * Stored locally (lib/vocabulary.ts) and reviewed via spaced repetition.
 * `dueAt` drives daily-deck eligibility; `interval` and `easeFactor` follow
 * an SM-2-style schedule.
 */
export interface VocabularyItem {
  id: string;
  /** Dictionary form, e.g. "essen", "Apfel" */
  lemma: string;
  /** Surface form when different from lemma; useful for irregulars */
  inflection?: string;
  partOfSpeech: VocabularyPos;
  /** Article for nouns: "der" | "die" | "das" */
  gender?: "der" | "die" | "das";
  /** Plural form for nouns when applicable */
  plural?: string;
  cefrLevel: CefrLevel;
  /** Optional link back to a grammar structure this word reinforces */
  structureId?: string;
  /** A natural example sentence using the lemma at the learner's level */
  exampleSentence: string;
  /** Translation in the learner's native language */
  l1Translation: string;

  // ── SRS state ──
  /** ISO date when added to deck */
  introduced: string;
  /** ISO date of the last grading, or null if never reviewed */
  lastReviewed: string | null;
  /** ISO date when the card is next eligible for review */
  dueAt: string;
  /** Current interval in days (0 = today, 1 = tomorrow, etc.) */
  interval: number;
  /** SM-2 ease factor (1.3..2.5+) — bigger means easier */
  easeFactor: number;
  /** Successful review count in a row (resets on lapse) */
  repetitions: number;
  /** Total times the learner forgot the word */
  lapses: number;
}

/**
 * Grading scale for vocabulary review. Borrowed from Anki / SM-2.
 * Maps to ease-factor and interval adjustments in lib/vocabulary.gradeVocabulary.
 */
export type VocabularyGrade = "again" | "hard" | "good" | "easy";

// ── Exercise pool ──

/** What shape of exercise we're pooling. Lifecycle is identical across kinds. */
export type PooledExerciseKind =
  | "drill"
  | "translate"
  | "error_spot"
  | "story"
  | "worksheet";

/**
 * How a pooled exercise gets graded at submit time.
 *   exact_match     — normalized string equality vs eval_spec.answer
 *   set_membership  — answer ∈ eval_spec.acceptable[]
 *   regex           — eval_spec.pattern matches (case-insensitive)
 *   llm             — falls through to /api/lesson/eval
 */
export type PooledExerciseEvalKind =
  | "exact_match"
  | "set_membership"
  | "regex"
  | "llm";

export type PooledExerciseStatus =
  | "pending"
  | "served"
  | "submitted"
  | "retired";

/**
 * One pre-generated exercise sitting in a learner's queue. Shape mirrors
 * `exercise_pool` table (supabase/schema-exercise-pool.sql).
 *
 * `payload` and `evalSpec` shapes depend on `kind` — destructuring lives in
 * the consumer (chat page, study page) and the eval dispatcher in
 * lib/exercisePool.ts.
 */
export interface PooledExercise {
  id: string;
  language: string;
  topicId: string;
  kind: PooledExerciseKind;
  payload: Record<string, unknown>;
  payloadHash: string;
  evalKind: PooledExerciseEvalKind;
  evalSpec: Record<string, unknown>;
  status: PooledExerciseStatus;
  batchId: string;
  generatedAt: string;
  servedAt: string | null;
  submittedAt: string | null;
  score: number | null;
}
