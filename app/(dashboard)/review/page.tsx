"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ErrorPattern, GrammarStructure, LearnerModel } from "@/types";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import { getLessonForStructure } from "@/lib/learningPath";
import { GRAMMAR_STRUCTURES, StructureDefinition } from "@/lib/grammarStructures";
import BrandMark from "@/components/BrandMark";
import GrammarTable from "@/components/GrammarTable";

/**
 * Review — Mistake of the Day.
 *
 * Promotes one error to full size with rule explanation; collapses the rest
 * into a quiet "N more to review" list. Implements brief Idea 02.
 */

function formatRecency(value: string | null | undefined): string {
  if (!value) return "first surfaced recently";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "first surfaced recently";
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days === 0) return "surfaced today";
  if (days === 1) return "surfaced yesterday";
  if (days < 7) return `surfaced ${days} days ago`;
  return `first surfaced ${Math.round(days / 7)}w ago`;
}

export default function ReviewPage() {
  const router = useRouter();
  const auth = useAuth();
  const [model, setModel] = useState<LearnerModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadLearnerModel(auth.user?.id ?? null).then((m) => {
      if (!cancelled) {
        setModel(m);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  const sortedErrors = useMemo<ErrorPattern[]>(() => {
    if (!model) return [];
    return [...model.errorPatterns].sort((a, b) => b.count - a.count);
  }, [model]);

  const motd = sortedErrors[0] ?? null;
  const remaining = sortedErrors.slice(1);
  const motdStructure: GrammarStructure | null = useMemo(() => {
    if (!motd || !model) return null;
    return model.structures.find((s) => s.id === motd.structureId) ?? null;
  }, [motd, model]);
  /**
   * Static structure metadata (whyThisHappens explanation + grammar table).
   * Lives in `lib/grammarStructures` keyed by id, distinct from the per-learner
   * mastery data that comes back in `motdStructure`.
   */
  const motdStaticDef: StructureDefinition | null = useMemo(() => {
    if (!motd) return null;
    return GRAMMAR_STRUCTURES.find((s) => s.id === motd.structureId) ?? null;
  }, [motd]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  if (!motd) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={40} />
        <h1 className="font-serif text-3xl font-medium tracking-[-0.01em] text-ink">
          Nothing to review yet.
        </h1>
        <p className="max-w-sm text-sm text-mute">
          Once you make a few mistakes in conversation, the most frequent one will surface here.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-2 rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Start a session
        </button>
      </div>
    );
  }

  function startDrill() {
    if (!motdStructure) return;
    const lessonId = getLessonForStructure(motdStructure.id);
    if (lessonId) router.push(`/chat?lesson=${lessonId}`);
    else router.push(`/?focus=${encodeURIComponent(motdStructure.id)}`);
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
            Review · 1 of {sortedErrors.length}
          </span>
        </div>
        <button
          onClick={() => router.push("/")}
          className="rounded-lg px-3 py-1.5 text-xs text-mute transition-colors hover:bg-line-2"
        >
          Back to chat
        </button>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Mistake of the day
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          One thing today, not twenty.
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-2">
          The most frequent slip from your recent sessions. Drill it for thirty seconds and
          the rest get quieter.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Left — the mistake */}
          <article className="rounded-2xl border border-line bg-paper-warm p-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              You said {motd.lastSeen ? `· ${new Date(motd.lastSeen).toLocaleDateString(undefined, { weekday: "long" })}` : ""}
            </p>
            <p className="mt-4 font-serif text-2xl font-medium leading-snug tracking-[-0.01em]">
              <span className="text-warn-ink line-through decoration-warn-ink decoration-2">{motd.example}</span>
              <span className="mx-2 text-mute">→</span>
              <span className="text-good-ink">{motd.correction}</span>
            </p>
            <p className="mt-4 text-sm text-ink-2">
              You&apos;ve made this swap{" "}
              <b className="text-ink">{motd.count}{motd.count === 1 ? " time" : " times"}</b>
              {motdStructure ? ` in ${motdStructure.name}.` : "."}
              {" "}
              <span className="text-mute">{formatRecency(motd.lastSeen)}.</span>
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                onClick={startDrill}
                className="rounded-full bg-ink px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90"
              >
                Drill 30 seconds
              </button>
              <button
                onClick={() => router.push("/")}
                className="rounded-full border border-line px-4 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2"
              >
                Skip · already got it
              </button>
            </div>
          </article>

          {/* Right — the rule */}
          <aside className="rounded-2xl border border-line bg-paper p-6">
            <p className="font-semibold text-ink">Why this happens</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              {motdStaticDef?.whyThisHappens ?? motd.pattern}
            </p>

            {motdStaticDef?.grammarTable && (
              <div className="mt-5">
                <GrammarTable table={motdStaticDef.grammarTable} mode="full" />
              </div>
            )}

            {motdStructure && (
              <div className="mt-5 rounded-xl border border-line bg-paper-warm p-4">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono uppercase tracking-[0.12em] text-mute">
                    Your mastery
                  </span>
                  <span className="text-ink-2">
                    {motdStructure.cefrLevel} · {motdStructure.attempts} attempts
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-2">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.round(motdStructure.mastery * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-mute">
                  {Math.round(motdStructure.mastery * 100)}% · last correct{" "}
                  {motdStructure.lastCorrect === null
                    ? "n/a"
                    : motdStructure.lastCorrect
                    ? "yes"
                    : "no"}
                </p>
              </div>
            )}
          </aside>
        </div>

        {/* Remaining — collapsed list */}
        {remaining.length > 0 && (
          <section className="mt-12">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              {remaining.length} more to review
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {remaining.map((err) => {
                const struct = model?.structures.find((s) => s.id === err.structureId);
                return (
                  <li
                    key={err.id}
                    className="rounded-xl border border-line bg-paper p-4"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[11px] text-mute">
                      <span>{struct?.name ?? err.structureId}</span>
                      <span>{err.count}×</span>
                    </div>
                    <p className="mt-2 text-sm">
                      <span className="text-warn-ink line-through decoration-1">{err.example}</span>
                    </p>
                    <p className="text-sm text-good-ink">{err.correction}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
