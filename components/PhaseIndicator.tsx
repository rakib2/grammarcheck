"use client";

import { LessonPhase } from "@/types";

interface PhaseIndicatorProps {
  currentPhase: LessonPhase;
  drillScore?: number | null;
  writeScore?: number | null;
}

const PHASES: { key: LessonPhase; label: string }[] = [
  { key: "teach",  label: "Learn" },
  { key: "drill",  label: "Drill" },
  { key: "write",  label: "Write" },
  { key: "review", label: "Review" },
];

export default function PhaseIndicator({ currentPhase, drillScore, writeScore }: PhaseIndicatorProps) {
  const currentIdx = PHASES.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const score = phase.key === "drill" ? drillScore : phase.key === "write" ? writeScore : null;

        return (
          <div key={phase.key} className="flex items-center">
            {i > 0 && (
              <div className={`mx-1 h-px w-3 ${isCompleted ? "bg-green-400" : "bg-gray-200"}`} />
            )}
            <div
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isCurrent
                  ? "bg-gray-900 text-white"
                  : isCompleted
                    ? "bg-green-50 text-green-600"
                    : "bg-gray-50 text-gray-400"
              }`}
            >
              {phase.label}
              {score !== null && score !== undefined && (
                <span className="ml-1 opacity-70">{score}%</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
