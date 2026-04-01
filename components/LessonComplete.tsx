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
}

export default function LessonComplete({
  lesson,
  drillScore,
  writeScore,
  passed,
  nextLesson,
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
        ) : !passed ? (
          <button
            onClick={() => router.push(`/chat?lesson=${lesson.id}&retry=1`)}
            className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Try Again
          </button>
        ) : null}
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
