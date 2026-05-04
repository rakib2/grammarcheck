"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CefrLevel, LearnerModel, UserLessonProgress } from "@/types";
import { CURRICULUM, CEFR_LEVELS } from "@/lib/curriculum";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import { supabase } from "@/lib/supabase";
import BrandMark from "@/components/BrandMark";

/**
 * Worksheet index — one entry per curriculum lesson, grouped by CEFR level.
 *
 * The colored hint mirrors the MasteryGrid styling: a touched lesson shows
 * a soft tint of "developing/strong/mastered"; an untouched one stays muted.
 * Clicking any tile drops the learner straight into a fillable worksheet
 * for that topic (`/worksheet/<lessonId>`).
 */

const LEVEL_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const TINT: Record<
  "untouched" | "learning" | "developing" | "strong" | "mastered" | "completed",
  { bg: string; color: string; borderColor: string }
> = {
  untouched: { bg: "#fbfaf6", color: "#6b6b73", borderColor: "#e7e6e1" },
  learning: { bg: "#f3efe2", color: "#3d3d44", borderColor: "#e7e6e1" },
  developing: { bg: "#e6decd", color: "#3d3d44", borderColor: "#dccfb6" },
  strong: { bg: "#cbe0bd", color: "#16161a", borderColor: "#b6d2a4" },
  mastered: { bg: "#7fae6a", color: "#fafaf8", borderColor: "#7fae6a" },
  completed: { bg: "#e7d8c6", color: "#3d3d44", borderColor: "#d8c5a8" },
};

export default function WorksheetIndexPage() {
  const auth = useAuth();
  const [model, setModel] = useState<LearnerModel | null>(null);
  const [progress, setProgress] = useState<Record<string, UserLessonProgress>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const userId = auth.user?.id ?? null;
      const m = await loadLearnerModel(userId);
      if (cancelled) return;
      setModel(m);

      // User progress drives the "completed" tint on the tile so finished
      // lessons are visually distinct from "in progress" ones.
      const { data: rows } = await supabase.from("user_progress").select("*");
      if (!cancelled && rows) {
        const map: Record<string, UserLessonProgress> = {};
        for (const row of rows) {
          map[row.lesson_id] = {
            id: row.id,
            userId: row.user_id,
            lessonId: row.lesson_id,
            status: row.status,
            phase: row.phase,
            drillScore: row.drill_score,
            writeScore: row.write_score,
            completedAt: row.completed_at,
          };
        }
        setProgress(map);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  const lessonsByLevel = useMemo(() => {
    const groups: Record<CefrLevel, typeof CURRICULUM> = {
      A1: [], A2: [], B1: [], B2: [], C1: [], C2: [],
    };
    for (const lesson of CURRICULUM) {
      groups[lesson.cefrLevel].push(lesson);
    }
    return groups;
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
            Worksheets
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Practice on paper or screen
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          Worksheets — fill in, check instantly, print if you like.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-2">
          Each topic generates a fresh fill-in-the-blank set every time. Submit in the
          browser for instant grading, or print and do it offline. Tap any topic to start.
        </p>

        {LEVEL_ORDER.map((lvl) => {
          const lessons = lessonsByLevel[lvl] ?? [];
          if (lessons.length === 0) return null;
          const meta = CEFR_LEVELS.find((l) => l.level === lvl);
          return (
            <section key={lvl} className="mt-10">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                {lvl} · {meta?.label ?? ""}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {lessons.map((lesson) => {
                  // Tint by mastery on the lesson's grammar focus, falling
                  // back to user_progress completion state.
                  const lessonProgress = progress[lesson.id];
                  const isCompleted = lessonProgress?.status === "completed";
                  // Mastery on the lesson's grammar focus when one exists.
                  const struct = model?.structures.find(
                    (s) => s.id === lesson.id || s.name === lesson.grammarFocus
                  );
                  const mastery = struct?.mastery ?? 0;
                  const attempts = struct?.attempts ?? 0;
                  const tint =
                    isCompleted
                      ? "completed"
                      : attempts === 0
                      ? "untouched"
                      : mastery < 0.3
                      ? "learning"
                      : mastery < 0.6
                      ? "developing"
                      : mastery < 0.85
                      ? "strong"
                      : "mastered";
                  const visual: React.CSSProperties = {
                    background: TINT[tint].bg,
                    color: TINT[tint].color,
                    borderColor: TINT[tint].borderColor,
                  };
                  return (
                    <Link
                      key={lesson.id}
                      href={`/worksheet/${lesson.id}`}
                      style={visual}
                      className="rounded-xl border p-4 transition-shadow hover:shadow-sm"
                    >
                      <p className="text-[11px] font-mono uppercase tracking-[0.08em] opacity-70">
                        {lesson.cefrLevel} · {tint === "untouched" ? "fresh" : tint}
                      </p>
                      <p className="mt-1 text-sm font-semibold leading-tight">
                        {lesson.title}
                      </p>
                      <p className="mt-1 text-[12px] leading-snug opacity-80 line-clamp-2">
                        {lesson.description}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
