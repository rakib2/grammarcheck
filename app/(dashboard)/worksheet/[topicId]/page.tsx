"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThinkingMark from "@/components/ThinkingMark";
import { useAuth } from "@/lib/AuthContext";
import { getLessonById } from "@/lib/curriculum";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import { ingestBatch, loadPoolSlice, markSubmitted } from "@/lib/exercisePoolSync";
import { evaluateLocally } from "@/lib/exercisePool";
import { ErrorPattern, PooledExercise } from "@/types";

/**
 * Worksheet — printable / fill-and-submit homework page.
 *
 * One worksheet = one batch_id of `kind='worksheet'` items in the pool. Each
 * item is a fill-in-the-blank with a deterministic eval spec, so grading is
 * instant on submit (no LLM round-trip). The page itself is print-friendly
 * — the user can hit Cmd/Ctrl-P and get a clean handout, or fill in the
 * browser and submit for an immediate score.
 *
 * Lifecycle:
 *   - Mount: try to load the latest unsubmitted worksheet for this topic
 *     from the pool. If empty, generate a fresh one via /api/worksheet/generate.
 *   - Submit: grade each item locally via {@link evaluateLocally}, write
 *     submitted_at + score back to the pool row, show results.
 *   - "Generate fresh worksheet": always creates a new batch_id, regardless
 *     of any unsubmitted leftovers.
 */

type AnswerMap = Record<string, string>;
type ResultMap = Record<string, { correct: boolean; score: number; feedback: string }>;

export default function WorksheetPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const auth = useAuth();
  const topicId = params?.topicId ?? "";
  const lesson = useMemo(() => (topicId ? getLessonById(topicId) : null), [topicId]);

  const [items, setItems] = useState<PooledExercise[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [errorPatterns, setErrorPatterns] = useState<ErrorPattern[]>([]);
  const [nativeLanguage, setNativeLanguage] = useState<string | null>(null);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [results, setResults] = useState<ResultMap | null>(null);

  // Load learner profile for the generation request (no blocking).
  useEffect(() => {
    let cancelled = false;
    loadLearnerModel(auth.user?.id ?? null).then((model) => {
      if (cancelled) return;
      if (model?.errorPatterns) setErrorPatterns(model.errorPatterns);
      if (model?.nativeLanguage) setNativeLanguage(model.nativeLanguage);
    });
    return () => { cancelled = true; };
  }, [auth.user?.id]);

  // Boot: pool first, generate on cold-start. Never blocks on Claude after
  // the first visit because subsequent visits read the same batch from pool.
  useEffect(() => {
    if (!lesson) return;
    let cancelled = false;
    (async () => {
      const userId = auth.user?.id ?? null;
      const slice = await loadPoolSlice(userId, lesson.id, "worksheet", 20);
      // Find the most recent batch_id among pending items
      const pending = slice.filter((e) => e.status === "pending" || e.status === "served");
      if (pending.length > 0) {
        // Group by batch_id, take the newest batch
        const newest = pending.reduce<{ batch: string; items: PooledExercise[] }>((acc, item) => {
          if (item.batchId === acc.batch) {
            acc.items.push(item);
            return acc;
          }
          if (!acc.batch || new Date(item.generatedAt).getTime() > new Date(acc.items[0]?.generatedAt ?? 0).getTime()) {
            return { batch: item.batchId, items: [item] };
          }
          return acc;
        }, { batch: "", items: [] });
        if (cancelled) return;
        if (newest.items.length > 0) {
          setItems(newest.items);
          setBatchId(newest.batch);
          setLoading(false);
          return;
        }
      }
      // Cold start — generate one.
      await generateWorksheet();
      if (cancelled) return;
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id]);

  async function generateWorksheet() {
    if (!lesson) return;
    setGenerating(true);
    setResults(null);
    setAnswers({});
    try {
      const res = await fetch("/api/worksheet/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: lesson.id,
          nativeLanguage,
          errorPatterns: errorPatterns.filter((e) => e.structureId.includes(lesson.id) || true),
          itemCount: 10,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { batchId?: string; items?: PooledExercise[] };
      const fresh = data.items ?? [];
      if (fresh.length === 0) return;
      await ingestBatch(auth.user?.id ?? null, lesson.id, "worksheet", fresh);
      setItems(fresh);
      setBatchId(data.batchId ?? null);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (items.length === 0) return;
    const next: ResultMap = {};
    for (const item of items) {
      const answer = (answers[item.id] ?? "").trim();
      const local = evaluateLocally(item.evalKind, item.evalSpec, answer);
      // Worksheet items are always rule-evaluable; if local returns null,
      // treat the item as incorrect rather than blocking on an LLM call.
      const r = local ?? {
        correct: false,
        score: 0,
        feedback: "Couldn't grade locally — please retry the worksheet.",
        evaluatedBy: "local" as const,
        latencyMs: 0,
      };
      next[item.id] = { correct: r.correct, score: r.score, feedback: r.feedback };
      void markSubmitted(
        auth.user?.id ?? null,
        item.id,
        item.topicId,
        "worksheet",
        r.score
      );
    }
    setResults(next);
  }

  const totalScore = useMemo(() => {
    if (!results) return 0;
    const vals = Object.values(results);
    if (vals.length === 0) return 0;
    return Math.round((vals.reduce((sum, r) => sum + r.score, 0) / vals.length) * 100);
  }, [results]);

  const correctCount = useMemo(() => {
    if (!results) return 0;
    return Object.values(results).filter((r) => r.correct).length;
  }, [results]);

  if (!lesson) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={36} />
        <h1 className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
          No worksheet for this topic.
        </h1>
        <p className="max-w-sm text-sm text-mute">
          We couldn&apos;t find a lesson called <code className="rounded bg-line-2 px-1.5 py-0.5">{topicId}</code>.
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

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      {/* Print-only inline styles — keep the paper version clean. */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3 no-print">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <button
            onClick={() => router.back()}
            className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-line"
          >
            ← Back
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            disabled={items.length === 0}
            className="rounded-full border border-line bg-paper px-4 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2 disabled:opacity-50"
            title="Print or save as PDF"
          >
            Print / Save as PDF
          </button>
          <button
            onClick={generateWorksheet}
            disabled={generating}
            className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Fresh worksheet"}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-10 print:py-6">
        {/* Worksheet header */}
        <div className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            Worksheet · {lesson.cefrLevel}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-[-0.02em] text-ink">
            {lesson.title}
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">
            {lesson.description}
          </p>
          <p className="mt-3 text-[11px] text-mute">
            Grammar focus: <span className="font-medium text-ink-2">{lesson.grammarFocus}</span>
            {batchId && <span> · Batch {batchId.slice(0, 8)}</span>}
          </p>
        </div>

        {/* Score banner — only after submission */}
        {results && (
          <div className="mb-6 rounded-2xl border border-line bg-paper-warm p-4 no-print">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                Score
              </p>
              <p className="font-serif text-3xl font-medium text-ink">{totalScore}%</p>
            </div>
            <p className="mt-1 text-xs text-mute">
              {correctCount} of {items.length} correct.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <ThinkingMark label="Loading worksheet…" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-mute">
            Couldn&apos;t generate a worksheet for this topic. Try again.
          </p>
        ) : (
          <ol className="space-y-5">
            {items.map((item, idx) => {
              const result = results?.[item.id];
              const prompt = typeof item.payload.prompt === "string" ? item.payload.prompt : "";
              const hint = typeof item.payload.hint === "string" ? item.payload.hint : "";
              return (
                <li
                  key={item.id}
                  className="rounded-xl border border-line bg-paper p-4 print:border-0 print:p-0 print:py-2"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[12px] text-mute">
                      {String(idx + 1).padStart(2, "0")}.
                    </span>
                    <p className="flex-1 text-sm leading-relaxed text-ink">{prompt}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                    <input
                      type="text"
                      value={answers[item.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      disabled={!!results}
                      placeholder="answer"
                      className={`min-w-[140px] rounded-md border bg-paper px-2 py-1 text-sm focus:outline-none focus:ring-2 ${
                        result
                          ? result.correct
                            ? "border-good-ink/40 bg-good-bg text-good-ink ring-good-ink/30"
                            : "border-warn-ink/40 bg-warn-bg text-warn-ink ring-warn-ink/30"
                          : "border-line text-ink focus:ring-ink/20"
                      } print:bg-transparent print:border-b print:border-ink/30 print:rounded-none`}
                    />
                    {hint && (
                      <span className="text-[11px] italic text-mute">({hint})</span>
                    )}
                    {result && !result.correct && (
                      <span className="text-[11px] text-mute no-print">
                        Expected:{" "}
                        <span className="font-medium text-good-ink">
                          {typeof item.payload.expectedAnswer === "string"
                            ? item.payload.expectedAnswer
                            : ""}
                        </span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Submit + actions */}
        {!results && items.length > 0 && (
          <div className="mt-8 flex justify-end gap-2 no-print">
            <button
              onClick={handleSubmit}
              disabled={generating}
              className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Check answers
            </button>
          </div>
        )}
        {results && (
          <div className="mt-8 flex justify-end gap-2 no-print">
            <button
              onClick={generateWorksheet}
              disabled={generating}
              className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Try a fresh worksheet"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
