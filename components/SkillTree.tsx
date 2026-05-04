"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CefrLevel, CurriculumLesson, UserLessonProgress, LessonStatus } from "@/types";
import { CEFR_LEVELS } from "@/lib/curriculum";

interface SkillTreeProps {
  lessons: CurriculumLesson[];
  progress: Record<string, UserLessonProgress>;
  activeLessonId?: string;
}

/**
 * Sidebar lesson tree.
 *
 * Quiet by design — the sidebar is navigation, so it stays grayscale to keep
 * the eye on the chat / reference / worksheet surfaces where colored
 * mastery info actually belongs. Status comes through a small dot indicator
 * (completed / in-progress / locked / available) and the active lesson's
 * background.
 */

export default function SkillTree({ lessons, progress, activeLessonId }: SkillTreeProps) {
  const router = useRouter();
  const [expandedLevels, setExpandedLevels] = useState<Set<CefrLevel>>(new Set<CefrLevel>());

  // Restore expanded levels from localStorage after hydration
  useEffect(() => {
    try {
      const saved = localStorage.getItem("expandedLevels");
      if (saved) {
        setExpandedLevels(new Set<CefrLevel>(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  // Persist expanded levels to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("expandedLevels", JSON.stringify(Array.from(expandedLevels)));
    } catch {}
  }, [expandedLevels]);

  // Auto-expand the level containing the active lesson
  useEffect(() => {
    if (!activeLessonId) return;
    const activeLesson = lessons.find((l) => l.id === activeLessonId);
    if (activeLesson && !expandedLevels.has(activeLesson.cefrLevel)) {
      setExpandedLevels((prev) => {
        const next = new Set(prev);
        next.add(activeLesson.cefrLevel);
        return next;
      });
    }
  }, [activeLessonId, lessons]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLevel(level: CefrLevel) {
    setExpandedLevels((prev) => {
      if (prev.has(level)) {
        return new Set<CefrLevel>();
      }
      return new Set<CefrLevel>([level]);
    });
  }

  function getStatus(lessonId: string): LessonStatus {
    return progress[lessonId]?.status ?? "locked";
  }

  function getLevelStats(level: CefrLevel) {
    const levelLessons = lessons.filter((l) => l.cefrLevel === level);
    const completed = levelLessons.filter((l) => getStatus(l.id) === "completed").length;
    return { total: levelLessons.length, completed };
  }

  function handleLessonClick(lesson: CurriculumLesson) {
    const status = getStatus(lesson.id);
    if (status === "locked") return;
    router.push(`/chat?lesson=${lesson.id}`);
  }

  return (
    <div className="space-y-0.5">
      {CEFR_LEVELS.map(({ level, label }) => {
        const stats = getLevelStats(level);
        const isExpanded = expandedLevels.has(level);
        const levelLessons = lessons
          .filter((l) => l.cefrLevel === level)
          .sort((a, b) => a.order - b.order);
        const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

        return (
          <div key={level}>
            {/* Level header */}
            <button
              onClick={() => toggleLevel(level)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50"
            >
              <span className="text-xs font-bold text-gray-400 w-5">{level}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">{label}</span>
                  <span className="text-[10px] text-gray-400">
                    {stats.completed}/{stats.total}
                  </span>
                </div>
                {pct > 0 && (
                  <div className="mt-1 h-0.5 w-full rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gray-400 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              <span className={`text-[10px] text-gray-300 transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                ▶
              </span>
            </button>

            {/* Lessons — neutral list with dot status. */}
            {isExpanded && (
              <div className="ml-7 border-l border-gray-100 pl-3 pb-1">
                {levelLessons.map((lesson) => {
                  const status = getStatus(lesson.id);
                  const isActive = lesson.id === activeLessonId;
                  const isLocked = status === "locked";
                  const isCompleted = status === "completed";

                  return (
                    <button
                      key={lesson.id}
                      onClick={() => handleLessonClick(lesson)}
                      disabled={isLocked}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isActive
                          ? "bg-gray-100"
                          : isLocked
                            ? "cursor-not-allowed opacity-40"
                            : "hover:bg-gray-50"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isCompleted ? "bg-gray-900" :
                        status === "in_progress" ? "bg-gray-400" :
                        isLocked ? "bg-gray-200" : "bg-gray-300"
                      }`} />
                      <span className={`truncate text-[11px] ${
                        isActive ? "font-medium text-gray-900" :
                        isLocked ? "text-gray-400" :
                        isCompleted ? "text-gray-500" : "text-gray-600"
                      }`}>
                        {lesson.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
