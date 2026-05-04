"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import SkillTree from "@/components/SkillTree";
import BrandMark from "@/components/BrandMark";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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
  const isReview = pathname === "/review";
  const isVocabulary = pathname === "/vocabulary";
  // Active for both the index and any /worksheet/<topic> page.
  const isWorksheet = pathname.startsWith("/worksheet");

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile backdrop */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar — slide-in drawer on mobile, static on md+ */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-gray-200 bg-white transition-transform duration-200 md:static md:w-[220px] md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-gray-100 px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={25} />
            <span className="text-sm font-semibold tracking-[-0.01em] text-gray-900">GrammarFlow</span>
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
            href="/review"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
              isReview
                ? "bg-gray-100 font-medium text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Mistake of the day
          </Link>
          <Link
            href="/worksheet"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
              isWorksheet
                ? "bg-gray-100 font-medium text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Worksheets
          </Link>
          <Link
            href="/vocabulary"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
              isVocabulary
                ? "bg-gray-100 font-medium text-gray-900"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Vocabulary
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
          <div className="mb-2 px-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
              Lessons
            </p>
          </div>
          <SkillTree lessons={CURRICULUM} progress={progress} activeLessonId={activeLessonId} />
        </div>

        <SidebarFooter completedCount={completedCount} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile-only hamburger header */}
        <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5 md:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
            className="rounded-md p-1.5 text-gray-700 hover:bg-gray-100"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <Link href="/" className="flex items-center gap-2">
            <BrandMark size={22} />
            <span className="text-sm font-semibold tracking-[-0.01em] text-gray-900">GrammarFlow</span>
          </Link>
        </div>
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
