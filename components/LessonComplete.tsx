"use client";

import { useRouter } from "next/navigation";
import { CurriculumLesson } from "@/types";
import ScoreRing from "@/components/ScoreRing";

interface LessonCompleteProps {
  lesson: CurriculumLesson;
  drillScore: number;
  writeScore: number;
  passed: boolean;
  nextLesson?: CurriculumLesson;
  onRetry?: () => void;
  /**
   * Optional brain-picked alternative path. When the learner is weak on a
   * structure that isn't part of the immediate-next lesson, surface it here
   * so the regular curriculum march doesn't bury the more useful detour.
   */
  focusedAlternative?: {
    lessonId: string;
    title: string;
    structureName: string;
    mastery: number;
    reason: string;
  } | null;
}

export default function LessonComplete({
  lesson,
  drillScore,
  writeScore,
  passed,
  nextLesson,
  onRetry,
  focusedAlternative,
}: LessonCompleteProps) {
  const router = useRouter();
  const avgScore = Math.round((drillScore + writeScore) / 2);

  return (
    <div className="mx-auto max-w-md space-y-5 rounded-2xl bg-white p-6 text-center ring-1 ring-gray-100 fade-in-up">
      <div className="score-pop mx-auto">
        <ScoreRing score={avgScore} size={80} />
      </div>

      {passed ? (
        <div>
          <h2 className="text-lg font-bold text-gray-900">Lesson Complete</h2>
          <p className="mt-1 text-sm text-gray-500">
            You&apos;ve mastered <span className="font-semibold text-gray-700">{lesson.title}</span>
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-lg font-bold text-gray-900">Almost There</h2>
          <p className="mt-1 text-sm text-gray-500">
            You need {lesson.passingScore}% to pass. Keep going!
          </p>
        </div>
      )}

      <div className="flex justify-center gap-4">
        <div className="rounded-xl bg-gray-50 px-4 py-2">
          <p className="text-[10px] font-medium uppercase text-gray-400">Drill</p>
          <p className="text-lg font-bold text-gray-900">{drillScore}%</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-2">
          <p className="text-[10px] font-medium uppercase text-gray-400">Write</p>
          <p className="text-lg font-bold text-gray-900">{writeScore}%</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-4 py-2">
          <p className="text-[10px] font-medium uppercase text-gray-400">Average</p>
          <p className="text-lg font-bold text-gray-900">{avgScore}%</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        {passed && nextLesson ? (
          <button
            onClick={() => router.push(`/chat?lesson=${nextLesson.id}`)}
            className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Next: {nextLesson.title}
          </button>
        ) : null}
        {focusedAlternative && (
          <button
            onClick={() => router.push(`/chat?lesson=${focusedAlternative.lessonId}`)}
            className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-left text-sm hover:bg-gray-50"
          >
            <p className="font-medium text-gray-900">
              Or focus on: {focusedAlternative.title}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {focusedAlternative.structureName} ·{" "}
              {Math.round(focusedAlternative.mastery * 100)}% mastery ·{" "}
              {focusedAlternative.reason}
            </p>
          </button>
        )}
        <button
          onClick={() => {
            if (onRetry) onRetry();
            else router.push(`/chat?lesson=${lesson.id}&attempt=${Date.now()}`);
          }}
          className={`rounded-xl px-5 py-2.5 text-sm font-semibold ${
            passed && nextLesson
              ? "bg-gray-50 text-gray-700 hover:bg-gray-100"
              : "bg-gray-900 text-white hover:bg-gray-800"
          }`}
        >
          Try Again
        </button>
        <button
          onClick={() => router.push("/progress")}
          className="rounded-xl bg-gray-50 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          Back to Overview
        </button>
      </div>
    </div>
  );
}
