"use client";

import { LessonPhase } from "@/types";

interface PhaseIndicatorProps {
  currentPhase: LessonPhase;
  drillScore?: number | null;
  translateScore?: number | null;
  storyScore?: number | null;
  writeScore?: number | null;
  errorSpotScore?: number | null;
  /** When false, the error-spot pill is omitted from the strip. */
  showErrorSpot?: boolean;
}

interface PhaseSpec {
  key: LessonPhase;
  label: string;
}

const FULL_PHASES: PhaseSpec[] = [
  { key: "teach",      label: "Learn" },
  { key: "drill",      label: "Drill" },
  { key: "translate",  label: "Translate" },
  { key: "story",      label: "Story" },
  { key: "write",      label: "Write" },
  { key: "error_spot", label: "Spot" },
  { key: "review",     label: "Review" },
];

export default function PhaseIndicator({
  currentPhase,
  drillScore,
  translateScore,
  storyScore,
  writeScore,
  errorSpotScore,
  showErrorSpot = true,
}: PhaseIndicatorProps) {
  const phases = showErrorSpot
    ? FULL_PHASES
    : FULL_PHASES.filter((p) => p.key !== "error_spot");
  const currentIdx = phases.findIndex((p) => p.key === currentPhase);

  function scoreFor(key: LessonPhase): number | null | undefined {
    switch (key) {
      case "drill":      return drillScore;
      case "translate":  return translateScore;
      case "story":      return storyScore;
      case "write":      return writeScore;
      case "error_spot": return errorSpotScore;
      default: return null;
    }
  }

  return (
    <div className="flex items-center gap-1">
      {phases.map((phase, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const score = scoreFor(phase.key);

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
