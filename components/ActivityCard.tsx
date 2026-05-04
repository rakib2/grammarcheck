"use client";

import { useEffect, useState } from "react";
import { MasterySnapshot, SessionSummary } from "@/lib/sessionMemory";
import { loadSnapshots, loadSummaries } from "@/lib/sessionMemorySync";
import { useAuth } from "@/lib/AuthContext";

/**
 * ActivityCard — right-rail activity widget for the home page.
 *
 * One self-contained piece: this-week sentence count vs target, plus a
 * 14-week heatmap (28 half-week buckets) coloured by real session
 * mastery. No fake counters — every signal comes from the snapshot /
 * summary brain in lib/sessionMemory.ts.
 */

const WEEKLY_SENTENCE_TARGET = 20;
const HEATMAP_WEEKS = 14;
const HEATMAP_BUCKETS_PER_WEEK = 2;
const HEATMAP_BUCKET_DAYS = 7 / HEATMAP_BUCKETS_PER_WEEK; // 3.5 days
const HEATMAP_TOTAL_CELLS = HEATMAP_WEEKS * HEATMAP_BUCKETS_PER_WEEK;
const RECENT_WINDOW_DAYS = 30;

interface HeatmapCell {
  start: Date;
  end: Date;
  intensity: 0 | 1 | 2 | 3 | 4;
}

const HEAT_BG: Record<HeatmapCell["intensity"], string> = {
  0: "bg-[#ecebe5]",
  1: "bg-[#dfe7d8]",
  2: "bg-[#bdd1ad]",
  3: "bg-[#90b97e]",
  4: "bg-[#5d9249]",
};

function startOfWeekMonday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function thisWeekSentenceCount(summaries: SessionSummary[]): number {
  const cutoff = startOfWeekMonday(new Date()).getTime();
  return summaries
    .filter((s) => new Date(s.timestamp).getTime() >= cutoff)
    .reduce((acc, s) => acc + s.turnCount, 0);
}

function buildHeatmap(snapshots: MasterySnapshot[]): HeatmapCell[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bucketMs = HEATMAP_BUCKET_DAYS * 86_400_000;
  const cells: HeatmapCell[] = [];
  for (let i = HEATMAP_TOTAL_CELLS - 1; i >= 0; i--) {
    const endTime = today.getTime() + 86_400_000 - 1 - i * bucketMs;
    const startTime = endTime - bucketMs + 1;
    let total = 0;
    let count = 0;
    for (const s of snapshots) {
      const t = new Date(s.timestamp).getTime();
      if (t >= startTime && t <= endTime) {
        total += s.stats.avgMastery;
        count += 1;
      }
    }
    let intensity: HeatmapCell["intensity"] = 0;
    if (count > 0) {
      const avg = total / count;
      intensity = Math.max(1, Math.min(4, Math.ceil(avg * 4))) as 1 | 2 | 3 | 4;
    }
    cells.push({ start: new Date(startTime), end: new Date(endTime), intensity });
  }
  return cells;
}

function daysActiveInWindow(snapshots: MasterySnapshot[], windowDays: number): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const days = new Set<string>();
  for (const s of snapshots) {
    const t = new Date(s.timestamp).getTime();
    if (t >= cutoff) days.add(new Date(s.timestamp).toISOString().slice(0, 10));
  }
  return days.size;
}

function longestStreakInWindow(snapshots: MasterySnapshot[], windowDays: number): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const days = new Set<string>();
  for (const s of snapshots) {
    if (new Date(s.timestamp).getTime() >= cutoff) {
      days.add(new Date(s.timestamp).toISOString().slice(0, 10));
    }
  }
  if (days.size === 0) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  let longest = 0;
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }
  return longest;
}

function formatBucketRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export default function ActivityCard() {
  const auth = useAuth();
  const [snapshots, setSnapshots] = useState<MasterySnapshot[]>([]);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const userId = auth.user?.id ?? null;
    Promise.all([loadSnapshots(userId), loadSummaries(userId)]).then(
      ([snaps, sums]) => {
        if (cancelled) return;
        setSnapshots(snaps);
        setSummaries(sums);
        setMounted(true);
      }
    );
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  // Avoid hydration mismatch — render an empty placeholder server-side
  if (!mounted) {
    return (
      <div className="rounded-xl border border-line bg-paper p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
          Activity
        </p>
      </div>
    );
  }

  const heatmap = buildHeatmap(snapshots);
  const weekCount = thisWeekSentenceCount(summaries);
  const weekProgressPct = Math.min(
    100,
    Math.round((weekCount / WEEKLY_SENTENCE_TARGET) * 100)
  );
  const daysActive = daysActiveInWindow(snapshots, RECENT_WINDOW_DAYS);
  const longestStreak = longestStreakInWindow(snapshots, RECENT_WINDOW_DAYS);

  return (
    <div className="rounded-xl border border-line bg-paper p-4 space-y-4">
      {/* This week — sentence count vs target */}
      <div>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-mute">This week</span>
          <span className="text-ink">
            {weekCount} / {WEEKLY_SENTENCE_TARGET}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-2">
          <div
            className="h-full rounded-full bg-ink transition-all"
            style={{ width: `${weekProgressPct}%` }}
          />
        </div>
      </div>

      {/* Heatmap — Last 14 weeks, 28 half-week buckets */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
          Last {HEATMAP_WEEKS} weeks
        </p>
        <div
          className="mt-2 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, minmax(0, 1fr))` }}
          aria-hidden="true"
        >
          {heatmap.map((cell) => (
            <span
              key={cell.start.toISOString()}
              title={formatBucketRange(cell.start, cell.end)}
              className={`aspect-square rounded-[2px] ${HEAT_BG[cell.intensity]}`}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-mute">
          {daysActive === 0
            ? "No sessions yet — finish one and the calendar fills in."
            : (
              <>
                {daysActive} of last {RECENT_WINDOW_DAYS} days
                {longestStreak > 1 && ` · longest stretch ${longestStreak} days`}
              </>
            )}
        </p>
      </div>
    </div>
  );
}
