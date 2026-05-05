"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { SessionSummary } from "@/lib/sessionMemory";
import { loadSummaries } from "@/lib/sessionMemorySync";
import { useAuth } from "@/lib/AuthContext";

/**
 * Session recap — "Today, in one screen".
 *
 * Three stats, one sentence of advice, one button. Implements brief Idea 04.
 * Pulls the most recent SessionSummary from localStorage. /chat redirects
 * here on session end instead of showing the modal popup.
 */

interface DerivedStats {
  sentences: number;
  accuracyPct: number;
  newStructures: number;
  improvedStructure: { name: string; deltaPct: number } | null;
  weakestStructure: { name: string; mastery: number } | null;
}

function deriveStats(summary: SessionSummary): DerivedStats {
  const totalAttempts = summary.turnCount;
  // accuracy = 1 − (errors / attempts), floored at 0
  const accuracyPct =
    totalAttempts > 0
      ? Math.max(0, Math.round((1 - summary.errorsThisSession / totalAttempts) * 100))
      : 0;

  // "New" = structures that went from 0 attempts (mastery 0) to anything
  const newStructures = summary.masteryDeltas.filter(
    (d) => d.before === 0 && d.after > 0
  ).length;

  const sortedByDelta = [...summary.masteryDeltas].sort(
    (a, b) => b.after - b.before - (a.after - a.before)
  );
  const top = sortedByDelta[0];
  const improvedStructure = top
    ? { name: top.name, deltaPct: Math.round((top.after - top.before) * 100) }
    : null;

  const sortedByMastery = [...summary.masteryDeltas].sort(
    (a, b) => a.after - b.after
  );
  const weakest = sortedByMastery[0];
  const weakestStructure = weakest
    ? { name: weakest.name, mastery: weakest.after }
    : null;

  return {
    sentences: totalAttempts,
    accuracyPct,
    newStructures,
    improvedStructure,
    weakestStructure,
  };
}

function formatDuration(timestamp: string): string {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000)
  );
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h}h`;
}

export default function SessionRecapPage() {
  const router = useRouter();
  const auth = useAuth();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadSummaries(auth.user?.id ?? null).then((summaries) => {
      if (cancelled) return;
      setSummary(summaries[summaries.length - 1] ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={40} />
        <h1 className="font-serif text-3xl font-medium tracking-[-0.01em] text-ink">
          No session to recap yet.
        </h1>
        <p className="max-w-sm text-sm text-mute">
          Finish a conversation and a one-screen recap will land here.
        </p>
        <button
          onClick={() => router.push("/practice")}
          className="mt-2 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Start a session
        </button>
      </div>
    );
  }

  const stats = deriveStats(summary);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
            Session · {formatDuration(summary.timestamp)}
          </span>
        </div>
        <button
          onClick={() => router.push("/practice")}
          className="rounded-lg px-3 py-1.5 text-xs text-mute transition-colors hover:bg-line-2"
        >
          Back to chat
        </button>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Today, in one screen
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          {summary.summaryText || "Session complete."}
        </h1>

        {/* Three stats */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-line bg-paper-warm p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Sentences</p>
            <p className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
              {stats.sentences}
            </p>
            <p className="mt-1 text-xs text-mute">
              {stats.sentences === 0 ? "no exchanges this session" : "exchanges this session"}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-paper-warm p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">Accuracy</p>
            <p className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
              {stats.accuracyPct}%
            </p>
            {stats.improvedStructure && stats.improvedStructure.deltaPct > 0 ? (
              <p className="mt-1 text-xs text-good-ink">
                +{stats.improvedStructure.deltaPct}% on {stats.improvedStructure.name}
              </p>
            ) : (
              <p className="mt-1 text-xs text-mute">{summary.errorsThisSession} corrected</p>
            )}
          </div>
          <div className="rounded-2xl border border-line bg-paper-warm p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">New for you</p>
            <p className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
              {stats.newStructures}
            </p>
            <p className="mt-1 text-xs text-mute">
              {stats.newStructures === 0
                ? "no new structures today"
                : stats.newStructures === 1
                ? "structure first surfaced"
                : "structures first surfaced"}
            </p>
          </div>
        </div>

        {/* One sentence of advice */}
        <div className="mt-8 rounded-2xl border border-line bg-paper p-6">
          <p className="font-semibold text-ink">Tomorrow, focus on this:</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-2">
            {summary.topWeakness && (
              <li>
                <b className="text-ink">{summary.topWeakness}</b> is still the place where
                a couple of forced prompts will move the needle most.
              </li>
            )}
            {stats.weakestStructure &&
              (!summary.topWeakness ||
                !summary.topWeakness.includes(stats.weakestStructure.name)) && (
                <li>
                  <b className="text-ink">{stats.weakestStructure.name}</b> finished at{" "}
                  {Math.round(stats.weakestStructure.mastery * 100)}% — worth a 2-minute drill.
                </li>
              )}
            {!summary.topWeakness && !stats.weakestStructure && (
              <li>Keep going — the model needs a few more turns to find a focus.</li>
            )}
          </ul>
        </div>

        {/* One button */}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.push("/practice")}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Start tomorrow&apos;s session
          </button>
          <button
            onClick={() => router.push("/review")}
            className="rounded-full border border-line px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
          >
            Review the mistake
          </button>
        </div>
      </div>
    </div>
  );
}
