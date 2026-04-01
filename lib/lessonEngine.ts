import { CurriculumLesson, LessonPhase } from "@/types";

/**
 * Build the coach messages for each lesson phase.
 * These are used client-side to display content and server-side for API prompts.
 */

export function getTeachMessages(lesson: CurriculumLesson): string[] {
  return [
    `📖 **${lesson.title}** (${lesson.cefrLevel})\n\n${lesson.teachContent}`,
    `Great! When you're ready, type **"ready"** and we'll start the drills.`,
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
 */
export function getNextPhase(
  currentPhase: LessonPhase,
  lesson: CurriculumLesson,
  drillIndex: number
): { phase: LessonPhase; drillIndex: number } {
  switch (currentPhase) {
    case "teach":
      return { phase: "drill", drillIndex: 0 };
    case "drill":
      if (drillIndex + 1 < lesson.drillPrompts.length) {
        return { phase: "drill", drillIndex: drillIndex + 1 };
      }
      return { phase: "write", drillIndex };
    case "write":
      return { phase: "review", drillIndex };
    case "review":
      return { phase: "teach", drillIndex: 0 }; // restart if retrying
    default:
      return { phase: "teach", drillIndex: 0 };
  }
}

/**
 * Build the system prompt for drill evaluation via the API.
 */
export function buildDrillEvalPrompt(lesson: CurriculumLesson, drillPrompt: string): string {
  return `You are a German grammar coach evaluating a drill exercise.

Grammar topic: ${lesson.grammarFocus}
CEFR Level: ${lesson.cefrLevel}

The drill prompt was: "${drillPrompt}"

The user has answered. Evaluate their answer and return ONLY valid JSON:
{
  "correct": true or false,
  "feedback": "Brief explanation of why the answer is correct or incorrect",
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
