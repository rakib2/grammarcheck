"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import SkillTree from "@/components/SkillTree";
import { CURRICULUM } from "@/lib/curriculum";
import { UserLessonProgress } from "@/types";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/AuthContext";
import AuthGuard from "@/components/AuthGuard";

/**
 * All lessons are always available — the tutor adapts to the learner,
 * not the other way around. Progress tracking shows what's been done,
 * but nothing is locked.
 */

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeLessonId = searchParams.get("lesson") ?? undefined;
  const [progress, setProgress] = useState<Record<string, UserLessonProgress>>({});

  useEffect(() => {
    async function loadProgress() {
      const { data: rows } = await supabase.from("user_progress").select("*");

      if (rows && rows.length > 0) {
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
      } else {
        // Initialize: all lessons available — tutor adapts, nothing locked
        const initial: Record<string, UserLessonProgress> = {};
        for (const lesson of CURRICULUM) {
          initial[lesson.id] = {
            id: "",
            userId: "",
            lessonId: lesson.id,
            status: "available",
            phase: "teach",
            drillScore: null,
            writeScore: null,
            completedAt: null,
          };
        }
        setProgress(initial);
      }
    }

    loadProgress();
  }, []);

  const completedCount = Object.values(progress).filter((p) => p.status === "completed").length;
  const isOverview = pathname === "/progress";

  return (
    <div className="grid h-screen grid-cols-[220px_1fr] bg-gray-50">
      {/* Sidebar */}
      <aside className="flex flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-900 text-[10px] font-bold text-white">G</span>
            <span className="text-sm font-semibold text-gray-900">GrammarCoach</span>
          </Link>
        </div>

        <div className="space-y-0.5 px-3 py-3 border-b border-gray-100">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Quick Practice
          </Link>
          <Link
            href="/progress"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
              isOverview
                ? "bg-gray-100 font-medium text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Overview
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-gray-400">
            Lessons
          </p>
          <SkillTree lessons={CURRICULUM} progress={progress} activeLessonId={activeLessonId} />
        </div>

        <SidebarFooter completedCount={completedCount} />
      </aside>

      <main className="flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}

function SidebarFooter({ completedCount }: { completedCount: number }) {
  const { user, signOut } = useAuth();

  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-1">
      <p className="text-[10px] text-gray-400">
        {completedCount}/{CURRICULUM.length} completed
      </p>
      {user && (
        <div className="flex items-center justify-between">
          <p className="truncate text-[10px] text-gray-400">{user.email}</p>
          <button
            onClick={signOut}
            className="text-[10px] text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Suspense fallback={
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      }>
        <DashboardLayoutInner>{children}</DashboardLayoutInner>
      </Suspense>
    </AuthGuard>
  );
}
