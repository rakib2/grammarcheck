"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { LearnerModel, ErrorPattern, GrammarStructure } from "@/types";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import { GRAMMAR_STRUCTURES, StructureDefinition } from "@/lib/grammarStructures";
import { getLessonForStructure } from "@/lib/learningPath";
import { CEFR_LEVELS } from "@/lib/curriculum";
import BrandMark from "@/components/BrandMark";
import GrammarTable from "@/components/GrammarTable";

/**
 * Study — per-structure detail page.
 *
 * Replaces the inline detail panel that used to live on /mastery. Each grammar
 * structure has its own URL (e.g. /study/a2_akkusativ) so it's bookmarkable
 * and shareable. Pulls real per-learner data: mastery from learnerModel, and
 * past errors against this structure from learnerModel.errorPatterns.
 */

function masteryLabel(mastery: number, attempts: number): string {
  if (attempts === 0) return "not seen yet";
  if (mastery < 0.3) return "learning";
  if (mastery < 0.6) return "developing";
  if (mastery < 0.85) return "strong";
  return "mastered";
}

function formatRecency(value: string | null | undefined): string {
  if (!value) return "recently";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "recently";
  const days = Math.max(0, Math.round((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `${Math.round(days / 7)}w ago`;
}

export default function StudyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const auth = useAuth();
  const structureId = params?.id ?? "";
  const [model, setModel] = useState<LearnerModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadLearnerModel(auth.user?.id ?? null).then((m) => {
      if (cancelled) return;
      setModel(m);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  const def: StructureDefinition | null = useMemo(
    () => GRAMMAR_STRUCTURES.find((s) => s.id === structureId) ?? null,
    [structureId]
  );

  const userStruct: GrammarStructure | null = useMemo(() => {
    if (!def || !model) return null;
    return model.structures.find((s) => s.id === def.id) ?? null;
  }, [def, model]);

  const myErrors: ErrorPattern[] = useMemo(() => {
    if (!def || !model) return [];
    return model.errorPatterns
      .filter((e) => e.structureId === def.id)
      .sort((a, b) => b.count - a.count);
  }, [def, model]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  if (!def) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={36} />
        <h1 className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
          Structure not found.
        </h1>
        <p className="max-w-sm text-sm text-mute">
          We don&apos;t have a study card for <code className="rounded bg-line-2 px-1.5 py-0.5">{structureId}</code> yet.
        </p>
        <Link
          href="/progress"
          className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Back to Overview
        </Link>
      </div>
    );
  }

  const cefrMeta = CEFR_LEVELS.find((l) => l.level === def.cefrLevel);
  const masteryPct = userStruct ? Math.round(userStruct.mastery * 100) : 0;
  const totalErrorCount = myErrors.reduce((sum, e) => sum + e.count, 0);

  function startPractice() {
    if (!def) return;
    const lessonId = getLessonForStructure(def.id);
    if (lessonId) router.push(`/chat?lesson=${lessonId}`);
    else router.push(`/?focus=${encodeURIComponent(def.id)}`);
  }

  const worksheetLessonId = def ? getLessonForStructure(def.id) : null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <Link
            href="/progress"
            className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-line"
          >
            ← Overview
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        {/* Hero */}
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          {def.cefrLevel} · {cefrMeta?.label ?? ""} · {masteryLabel(userStruct?.mastery ?? 0, userStruct?.attempts ?? 0)}
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          {def.name}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-2">
          {def.whyThisHappens ?? def.description}
        </p>

        {/* Practice CTA */}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={startPractice}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Practice this
          </button>
          {worksheetLessonId && (
            <Link
              href={`/worksheet/${worksheetLessonId}`}
              className="rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
            >
              Worksheet
            </Link>
          )}
          <Link
            href="/progress"
            className="rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
          >
            See related structures
          </Link>
        </div>

        {/* Grammar table */}
        {def.grammarTable && (
          <section className="mt-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Reference
            </p>
            <div className="mt-3">
              <GrammarTable table={def.grammarTable} mode="full" />
            </div>
          </section>
        )}

        {/* Mastery + activity */}
        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-paper-warm p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Your mastery
            </p>
            <p className="mt-2 font-serif text-3xl font-medium tracking-[-0.01em] text-ink">
              {userStruct ? `${masteryPct}%` : "—"}
            </p>
            <p className="mt-1 text-xs text-mute">
              {userStruct
                ? `${userStruct.attempts} attempt${userStruct.attempts === 1 ? "" : "s"} · last ${formatRecency(userStruct.lastSeen)}`
                : "Not encountered yet — practice to start."}
            </p>
            {userStruct && userStruct.attempts > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-2">
                <div
                  className="h-full rounded-full bg-accent transition-all"
                  style={{ width: `${Math.max(masteryPct, 2)}%` }}
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-paper-warm p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Errors against this rule
            </p>
            <p className="mt-2 font-serif text-3xl font-medium tracking-[-0.01em] text-ink">
              {totalErrorCount}
            </p>
            <p className="mt-1 text-xs text-mute">
              {myErrors.length === 0
                ? "Clean so far."
                : `${myErrors.length} pattern${myErrors.length === 1 ? "" : "s"} tracked`}
            </p>
          </div>
        </section>

        {/* Your past errors against this structure */}
        {myErrors.length > 0 && (
          <section className="mt-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Your slips on this rule
            </p>
            <p className="mt-2 max-w-xl text-sm text-ink-2">
              These are sentences where you&apos;ve hit this exact rule. Reading
              your own mistakes is one of the most effective ways to internalise
              the fix.
            </p>
            <ul className="mt-4 space-y-3">
              {myErrors.map((err) => (
                <li
                  key={err.id}
                  className="rounded-xl border border-line bg-paper p-4"
                >
                  <div className="flex items-baseline justify-between text-[11px] text-mute">
                    <span className="font-mono uppercase tracking-[0.08em]">
                      {err.correctionLevel}
                    </span>
                    <span>{err.count}× · last {formatRecency(err.lastSeen)}</span>
                  </div>
                  <p className="mt-2 text-sm">
                    <span className="text-warn-ink line-through decoration-1">{err.example}</span>
                  </p>
                  <p className="text-sm text-good-ink">{err.correction}</p>
                  {err.pattern && (
                    <p className="mt-1 text-xs italic text-mute">{err.pattern}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Eliciting prompts — try-saying suggestions for users who haven't
            generated their own examples yet */}
        {myErrors.length === 0 && def.elicitingPrompts.length > 0 && (
          <section className="mt-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Try saying
            </p>
            <p className="mt-2 max-w-xl text-sm text-ink-2">
              These prompts naturally elicit this structure. Once you produce
              sentences against this rule, your own slips appear here as study
              material.
            </p>
            <ul className="mt-4 space-y-2">
              {def.elicitingPrompts.map((prompt, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink-2"
                >
                  {prompt}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* L1 interference — when learner's native language is in the map */}
        {model?.nativeLanguage && def.l1Interference[model.nativeLanguage] && (
          <section className="mt-10">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              From a {model.nativeLanguage} speaker&apos;s perspective
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">
              {def.l1Interference[model.nativeLanguage]}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
