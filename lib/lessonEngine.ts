import { CurriculumLesson, LessonPhase, ErrorPattern } from "@/types";

/**
 * Build the coach messages for each lesson phase.
 * These are used client-side to display content and server-side for API prompts.
 */

/** Number of translate prompts in a single lesson session. */
export const TRANSLATE_PROMPT_COUNT = 3;
/** Max attempts a learner gets per translate prompt before auto-advancing. */
export const TRANSLATE_MAX_ATTEMPTS = 3;
export const ADAPTIVE_DRILL_MIN_ITEMS = 4;
export const ADAPTIVE_DRILL_MAX_ITEMS = 8;
export const ADAPTIVE_DRILL_GRADUATION_STREAK = 3;

export type DynamicDrillMode =
  | "recognize"
  | "complete"
  | "transform"
  | "produce"
  | "recall"
  | "story";

export interface DynamicDrillItem {
  mode: DynamicDrillMode;
  prompt: string;
  expectedAnswer: string;
  hint: string;
  targetSkill: string;
}

export interface DynamicReferenceExample {
  german: string;
  translation: string;
  note: string;
}

export interface FocusedTranslatePrompt {
  english: string;
  germanReference: string;
  hints: string[];
}

export interface FocusedSessionPlan {
  referenceExamples: DynamicReferenceExample[];
  drillItems: DynamicDrillItem[];
  translatePrompts: FocusedTranslatePrompt[];
  storySetup: string;
  source: "fallback" | "ai";
}

function buildFallbackTranslatePrompts(lesson: CurriculumLesson): FocusedTranslatePrompt[] {
  const focus = lesson.grammarFocus.toLowerCase();

  if (focus.includes("regular verb")) {
    return [
      {
        english: "I learn German every morning.",
        germanReference: "Ich lerne jeden Morgen Deutsch.",
        hints: ["ich", "lerne", "jeden Morgen"],
      },
      {
        english: "We buy bread and drink water.",
        germanReference: "Wir kaufen Brot und trinken Wasser.",
        hints: ["wir", "kaufen", "trinken"],
      },
      {
        english: "Do you live in Berlin?",
        germanReference: "Wohnst du in Berlin?",
        hints: ["wohnst", "du", "in Berlin"],
      },
    ];
  }

  if (focus.includes("sein") || focus.includes("haben")) {
    return [
      {
        english: "I am tired today.",
        germanReference: "Ich bin heute müde.",
        hints: ["ich", "bin", "müde"],
      },
      {
        english: "We have two questions.",
        germanReference: "Wir haben zwei Fragen.",
        hints: ["wir", "haben", "Fragen"],
      },
      {
        english: "She is friendly and has time.",
        germanReference: "Sie ist freundlich und hat Zeit.",
        hints: ["sie", "ist", "hat"],
      },
    ];
  }

  if (focus.includes("sentence structure") || focus.includes("svo")) {
    return [
      {
        english: "I drink coffee.",
        germanReference: "Ich trinke Kaffee.",
        hints: ["ich", "trinke", "Kaffee"],
      },
      {
        english: "Maria reads a book.",
        germanReference: "Maria liest ein Buch.",
        hints: ["Maria", "liest", "ein Buch"],
      },
      {
        english: "We buy bread today.",
        germanReference: "Wir kaufen heute Brot.",
        hints: ["wir", "kaufen", "Brot"],
      },
    ];
  }

  if (focus.includes("akkusativ")) {
    return [
      {
        english: "I see the man.",
        germanReference: "Ich sehe den Mann.",
        hints: ["sehe", "den Mann"],
      },
      {
        english: "She buys a cake.",
        germanReference: "Sie kauft einen Kuchen.",
        hints: ["kauft", "einen Kuchen"],
      },
      {
        english: "We need the computer.",
        germanReference: "Wir brauchen den Computer.",
        hints: ["brauchen", "den Computer"],
      },
    ];
  }

  if (focus.includes("nominativ") || focus.includes("article")) {
    return [
      {
        english: "The table is big.",
        germanReference: "Der Tisch ist groß.",
        hints: ["der Tisch", "ist"],
      },
      {
        english: "A woman is learning German.",
        germanReference: "Eine Frau lernt Deutsch.",
        hints: ["eine Frau", "lernt"],
      },
      {
        english: "The child is playing today.",
        germanReference: "Das Kind spielt heute.",
        hints: ["das Kind", "spielt"],
      },
    ];
  }

  if (focus.includes("dativ")) {
    return [
      {
        english: "I give the teacher the book.",
        germanReference: "Ich gebe dem Lehrer das Buch.",
        hints: ["dem Lehrer", "das Buch"],
      },
      {
        english: "She helps the woman.",
        germanReference: "Sie hilft der Frau.",
        hints: ["hilft", "der Frau"],
      },
      {
        english: "We write the children a letter.",
        germanReference: "Wir schreiben den Kindern einen Brief.",
        hints: ["den Kindern", "einen Brief"],
      },
    ];
  }

  if (focus.includes("nicht") || focus.includes("kein")) {
    return [
      {
        english: "I do not have a car.",
        germanReference: "Ich habe kein Auto.",
        hints: ["habe", "kein Auto"],
      },
      {
        english: "He is not coming today.",
        germanReference: "Er kommt heute nicht.",
        hints: ["kommt", "nicht"],
      },
      {
        english: "She does not drink coffee.",
        germanReference: "Sie trinkt keinen Kaffee.",
        hints: ["trinkt", "keinen Kaffee"],
      },
    ];
  }

  if (focus.includes("modal")) {
    return [
      {
        english: "I can speak German.",
        germanReference: "Ich kann Deutsch sprechen.",
        hints: ["kann", "sprechen"],
      },
      {
        english: "We must work today.",
        germanReference: "Wir müssen heute arbeiten.",
        hints: ["müssen", "arbeiten"],
      },
      {
        english: "She wants to go home.",
        germanReference: "Sie will nach Hause gehen.",
        hints: ["will", "gehen"],
      },
    ];
  }

  if (focus.includes("perfekt")) {
    return [
      {
        english: "I played football yesterday.",
        germanReference: "Ich habe gestern Fußball gespielt.",
        hints: ["habe", "gespielt"],
      },
      {
        english: "She went to Berlin.",
        germanReference: "Sie ist nach Berlin gefahren.",
        hints: ["ist", "gefahren"],
      },
      {
        english: "We bought bread.",
        germanReference: "Wir haben Brot gekauft.",
        hints: ["haben", "gekauft"],
      },
    ];
  }

  return [
    {
      english: `I practice ${lesson.title.toLowerCase()} today.`,
      germanReference: "",
      hints: [lesson.grammarFocus],
    },
    {
      english: `We use this grammar in a short sentence.`,
      germanReference: "",
      hints: [lesson.grammarFocus],
    },
    {
      english: `Now I write one natural example with this rule.`,
      germanReference: "",
      hints: [lesson.grammarFocus],
    },
  ];
}

export function buildFallbackFocusedSessionPlan(lesson: CurriculumLesson): FocusedSessionPlan {
  const fallbackDrills = lesson.drillPrompts.length > 0
    ? lesson.drillPrompts
    : [
        `Write one German sentence that uses ${lesson.grammarFocus}.`,
        `Correct this sentence using ${lesson.grammarFocus}.`,
        `Transform the sentence so it still uses ${lesson.grammarFocus}.`,
        lesson.writePrompt,
      ];

  return {
    source: "fallback",
    referenceExamples: [
      {
        german: "Ich lerne jeden Tag ein bisschen Deutsch.",
        translation: "I learn a little German every day.",
        note: "A stable fallback example; the AI session can replace this with fresher examples.",
      },
      {
        german: "Wir üben die Regel zuerst langsam und dann frei.",
        translation: "We practice the rule slowly first and then freely.",
        note: "The target grammar should move from recognition to production.",
      },
    ],
    drillItems: Array.from({ length: ADAPTIVE_DRILL_MAX_ITEMS }, (_, idx) => {
      const prompt = fallbackDrills[idx % fallbackDrills.length];
      return {
        mode: idx < 2 ? "complete" : idx < 5 ? "transform" : "produce",
        prompt,
        expectedAnswer: "",
        hint: lesson.grammarFocus,
        targetSkill: lesson.grammarFocus,
      };
    }),
    translatePrompts: buildFallbackTranslatePrompts(lesson),
    storySetup:
      "Imagine you are telling a friend about your day. Use the target grammar naturally.",
  };
}

export function getTeachMessages(lesson: CurriculumLesson): string[] {
  // The full lesson content lives in the always-visible reference rail
  // (right side on desktop, drawer on mobile). The chat just frames the
  // session — no wall-of-text duplicate that scrolls away once practice
  // starts.
  return [
    `**${lesson.title}** — ${lesson.cefrLevel}. The reference is open beside the chat and stays with you the whole lesson.`,
    `Type **"ready"** when you want to start the drills.`,
  ];
}

export function getDrillPrompt(lesson: CurriculumLesson, drillIndex: number): string | null {
  if (drillIndex >= lesson.drillPrompts.length) return null;
  return `🎯 **Drill ${drillIndex + 1}/${lesson.drillPrompts.length}**\n\n${lesson.drillPrompts[drillIndex]}`;
}

export function getWritePrompt(lesson: CurriculumLesson): string {
  return `✏️ **Free Writing**\n\n${lesson.writePrompt}\n\nI'll analyze your grammar focusing on: **${lesson.grammarFocus}**`;
}

export function getReviewIntro(drillScore: number, writeScore: number, passed: boolean): string {
  const avg = Math.round((drillScore + writeScore) / 2);
  if (passed) {
    return `⭐ **Lesson Complete!**\n\nDrill score: **${drillScore}%** | Writing score: **${writeScore}%** | Average: **${avg}%**\n\nExcellent work! You've earned **${avg * 3} XP**. Ready for the next lesson!`;
  }
  return `💪 **Almost there!**\n\nDrill score: **${drillScore}%** | Writing score: **${writeScore}%** | Average: **${avg}%**\n\nYou need a bit more practice on this topic. Let's try again — you'll get it!`;
}

/**
 * Determine the next phase based on current state.
 *
 * Phase order:
 *   teach → drill[*] → translate → write → error_spot? → review
 *
 * `error_spot` is only inserted when {@link hasErrorSpotMaterial} returns true —
 * we don't want to invent fake errors for learners who haven't slipped on this
 * structure yet.
 */
export function getNextPhase(
  currentPhase: LessonPhase,
  lesson: CurriculumLesson,
  drillIndex: number,
  options: { hasErrorSpot?: boolean } = {}
): { phase: LessonPhase; drillIndex: number } {
  const { hasErrorSpot = false } = options;
  switch (currentPhase) {
    case "teach":
      return { phase: "drill", drillIndex: 0 };
    case "drill":
      if (drillIndex + 1 < lesson.drillPrompts.length) {
        return { phase: "drill", drillIndex: drillIndex + 1 };
      }
      return { phase: "translate", drillIndex };
    case "translate":
      return { phase: "story", drillIndex };
    case "story":
      return { phase: "write", drillIndex };
    case "write":
      return hasErrorSpot
        ? { phase: "error_spot", drillIndex }
        : { phase: "review", drillIndex };
    case "error_spot":
      return { phase: "review", drillIndex };
    case "review":
      return { phase: "teach", drillIndex: 0 }; // restart if retrying
    default:
      return { phase: "teach", drillIndex: 0 };
  }
}

/** Are there usable past errors for this lesson's structure? */
export function hasErrorSpotMaterial(
  errorPatterns: ErrorPattern[],
  structureId: string | null
): boolean {
  if (!structureId) return false;
  return errorPatterns.some(
    (e) => e.structureId === structureId && !!e.example && !!e.correction
  );
}

/** Return the strongest error candidate for the error-spot phase. */
export function pickErrorSpotMaterial(
  errorPatterns: ErrorPattern[],
  structureId: string
): ErrorPattern | null {
  return (
    errorPatterns
      .filter((e) => e.structureId === structureId && e.example && e.correction)
      .sort((a, b) => b.count - a.count)[0] ?? null
  );
}

// ── Translate phase ────────────────────────────────────────

/** UI intro message displayed when entering the translate phase. */
export function getTranslateIntro(lesson: CurriculumLesson): string {
  return `🌉 **Translate**\n\nNow let's work the other direction — I'll give you ${TRANSLATE_PROMPT_COUNT} short English sentences and you translate to German. Hints fade as we go.\n\n_Focus: ${lesson.grammarFocus}._`;
}

/** System prompt for AI to GENERATE the translate prompts in a single shot. */
export function buildTranslatePromptsSystem(lesson: CurriculumLesson): string {
  return `You generate translation drills for a German learner.

Lesson: "${lesson.title}" (${lesson.cefrLevel})
Grammar focus: ${lesson.grammarFocus}

Output ONLY a single JSON object of this exact shape:
{
  "prompts": [
    {
      "english": string,                    // ONE short, natural English sentence
      "germanReference": string,            // a correct German translation
      "hints": string[]                     // 3-5 useful German tokens (article, verb form, key noun) for first attempt
    }
  ]
}

Rules:
- Produce exactly ${TRANSLATE_PROMPT_COUNT} items.
- Each English sentence must NATURALLY require the lesson's grammar focus to translate correctly.
- Order from easier to harder so hint-fading feels like a ramp.
- Hints are individual tokens, not full sentences. Include article + key inflected form when relevant.
- Keep sentences at the lesson's CEFR level. No idioms, no rare vocabulary.
- Do NOT wrap output in markdown or commentary — just the JSON object.`;
}

export function getStoryIntro(lesson: CurriculumLesson, storySetup?: string): string {
  return `🎭 **Story mode**\n\n${storySetup || "Let's use this grammar in a short realistic situation."}\n\nAnswer naturally in German. I'll check whether you can use **${lesson.grammarFocus}** while still sounding like yourself.`;
}

export function buildFocusedSessionPlanSystem(lesson: CurriculumLesson): string {
  return `You design adaptive focused practice for a German grammar app.

Lesson: "${lesson.title}" (${lesson.cefrLevel})
Grammar focus: ${lesson.grammarFocus}
Core lesson content:
${lesson.teachContent}

Return ONLY valid JSON:
{
  "referenceExamples": [
    {
      "german": string,
      "translation": string,
      "note": string
    }
  ],
  "drillItems": [
    {
      "mode": "recognize" | "complete" | "transform" | "produce" | "recall" | "story",
      "prompt": string,
      "expectedAnswer": string,
      "hint": string,
      "targetSkill": string
    }
  ],
  "translatePrompts": [
    {
      "english": string,
      "germanReference": string,
      "hints": string[]
    }
  ],
  "storySetup": string
}

Rules:
- Generate exactly 6 fresh reference examples. They must be different from the lesson's static examples.
- Generate exactly ${ADAPTIVE_DRILL_MAX_ITEMS} drill items.
- Generate exactly ${TRANSLATE_PROMPT_COUNT} translatePrompts.
- The drill sequence must ramp up: recognition -> completion -> transformation -> production -> recall/story.
- Translate prompts should be short English prompts/sentences that naturally require the grammar focus in German.
- Every drill must naturally require ${lesson.grammarFocus}; avoid generic vocabulary tests.
- Include at least one "story" drill item that feels like a tiny roleplay or scenario.
- If the user has past mistakes in the message, include at least one "recall" item based on those mistakes.
- Keep language at ${lesson.cefrLevel}; interesting but not obscure.
- Prompts should be concise and directly answerable.`;
}

export function buildStoryEvalSystem(lesson: CurriculumLesson, storySetup: string): string {
  return `You are evaluating a short German story-mode answer.

Lesson: "${lesson.title}" (${lesson.cefrLevel})
Grammar focus: ${lesson.grammarFocus}
Story setup: ${storySetup}

Return ONLY valid JSON:
{
  "score": integer 0-100,
  "correct": boolean,
  "feedback": string,
  "correctAnswer": string
}

Grade whether the learner communicated naturally AND used the grammar focus correctly.
If their answer is understandable but misses the target grammar, score below 70 and provide a corrected model answer.`;
}

/** System prompt for AI to GRADE a learner's translation attempt. */
export function buildTranslateEvalSystem(
  lesson: CurriculumLesson,
  english: string,
  germanReference: string
): string {
  return `You are a German grammar coach grading a translation drill.

Lesson: "${lesson.title}" (${lesson.cefrLevel})
Grammar focus: ${lesson.grammarFocus}

The learner is translating this English sentence to German:
  English:           "${english}"
  Reference German:  "${germanReference || "(not precomputed; create a natural model answer)"}"

Multiple correct translations exist; reward semantic + grammatical correctness over exact word match. Give partial credit when meaning is right but a small grammar slip is present (e.g. wrong article case is -15, swapped verb position -20, missing subject -30).

Return ONLY valid JSON:
{
  "score": integer (0-100),
  "correct": boolean (true if score >= 70),
  "feedback": string (one short overall sentence),
  "correctAnswer": string (a clean correct German sentence; equal to the reference unless the reference itself is awkward),
  "issues": [
    {
      "original": string (the learner's exact problematic phrase, or "" if missing),
      "correction": string (the corrected phrase),
      "explanation": string (specific reason in learner-friendly English),
      "severity": "minor" | "major"
    }
  ],
  "nextStep": string (one short targeted practice instruction)
}`;
}

// ── Error-spot phase ──────────────────────────────────────

export function getErrorSpotIntro(): string {
  return `🔍 **Spot the slip**\n\nHere's a sentence built from one of your own past mistakes. Tell me what's wrong and how you'd fix it.`;
}

export function buildErrorSpotEvalSystem(
  lesson: CurriculumLesson,
  buggySentence: string,
  fixedSentence: string
): string {
  return `You are a German grammar coach grading an error-detection exercise.

Lesson: "${lesson.title}" (${lesson.cefrLevel})
Grammar focus: ${lesson.grammarFocus}

The learner saw this sentence (which contains an error from their own history):
  Buggy:    "${buggySentence}"
  Correct:  "${fixedSentence}"

The learner's response should (a) identify the error and (b) provide a corrected sentence. Score on identification + correction:
  - Both right: 100
  - Correction right but didn't articulate the error: 80
  - Identified the error but correction is wrong: 50
  - Wrong on both: 0–30

Return ONLY valid JSON:
{
  "score": integer (0-100),
  "correct": boolean (true if score >= 70),
  "feedback": string (one or two short sentences in English),
  "correctAnswer": string (the fixed sentence)
}`;
}

/**
 * Build the system prompt for drill evaluation via the API.
 */
export function buildDrillEvalPrompt(
  lesson: CurriculumLesson,
  drillPrompt: string,
  expectedAnswer?: string,
  targetSkill?: string
): string {
  return `You are a German grammar coach evaluating a drill exercise.

Grammar topic: ${lesson.grammarFocus}
CEFR Level: ${lesson.cefrLevel}

The drill prompt was: "${drillPrompt}"
${expectedAnswer ? `Expected/model answer: "${expectedAnswer}"` : ""}
${targetSkill ? `Target skill: ${targetSkill}` : ""}

The user has answered. Evaluate their answer and return ONLY valid JSON:
{
  "correct": true or false,
  "feedback": "Brief explanation of why the answer is correct or incorrect. If incorrect, name the exact grammar issue.",
  "correctAnswer": "The correct answer if the user was wrong"
}`;
}

/**
 * Calculate drill score from individual drill results.
 */
export function calculateDrillScore(results: { correct: boolean }[]): number {
  if (results.length === 0) return 0;
  const correct = results.filter((r) => r.correct).length;
  return Math.round((correct / results.length) * 100);
}
