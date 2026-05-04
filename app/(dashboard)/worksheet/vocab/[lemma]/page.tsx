"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThinkingMark from "@/components/ThinkingMark";
import { useAuth } from "@/lib/AuthContext";
import { evaluateLocally } from "@/lib/exercisePool";
import { ingestBatch, markSubmitted } from "@/lib/exercisePoolSync";
import { loadVocabulary } from "@/lib/vocabularySync";
import type { PooledExercise, VocabularyItem } from "@/types";

/**
 * Vocabulary-focused worksheet page.
 *
 * Generates 8–10 fill-in-the-blank items anchored on a single lemma. Same
 * print-friendly UI + browser-fillable form as the lesson worksheet
 * (`/worksheet/[topicId]`), but the backing API is `/api/worksheet/vocab/generate`
 * and items are tagged `topicId = vocab:<lemma>`.
 */

type AnswerMap = Record<string, string>;
type ResultMap = Record<string, { correct: boolean; score: number; feedback: string }>;

export default function VocabWorksheetPage() {
  const params = useParams<{ lemma: string }>();
  const router = useRouter();
  const auth = useAuth();
  const lemma = useMemo(() => decodeURIComponent(params?.lemma ?? ""), [params?.lemma]);

  const [item, setItem] = useState<VocabularyItem | null>(null);
  const [items, setItems] = useState<PooledExercise[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [results, setResults] = useState<ResultMap | null>(null);

  useEffect(() => {
    if (!lemma) return;
    let cancelled = false;
    (async () => {
      const userId = auth.user?.id ?? null;
      const deck = await loadVocabulary(userId);
      if (cancelled) return;
      const found = deck.find((d) => d.lemma === lemma) ?? null;
      setItem(found);
      if (!found) {
        setLoading(false);
        return;
      }
      await generateWorksheet(found);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lemma]);

  async function generateWorksheet(target: VocabularyItem) {
    setGenerating(true);
    setResults(null);
    setAnswers({});
    try {
      const res = await fetch("/api/worksheet/vocab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lemma: target.lemma,
          partOfSpeech: target.partOfSpeech,
          cefrLevel: target.cefrLevel,
          gender: target.gender ?? null,
          plural: target.plural ?? null,
          example: target.exampleSentence,
          l1Translation: target.l1Translation,
          itemCount: 10,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { batchId?: string; items?: PooledExercise[] };
      const fresh = data.items ?? [];
      if (fresh.length === 0) return;
      // Persist via the standard pool flow so submitted scores feed
      // the brain layer's adaptation hints downstream.
      await ingestBatch(auth.user?.id ?? null, `vocab:${target.lemma}`, "worksheet", fresh);
      setItems(fresh);
      setBatchId(data.batchId ?? null);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (items.length === 0) return;
    const next: ResultMap = {};
    for (const it of items) {
      const answer = (answers[it.id] ?? "").trim();
      const local = evaluateLocally(it.evalKind, it.evalSpec, answer);
      const r = local ?? {
        correct: false,
        score: 0,
        feedback: "Couldn't grade locally — please retry the worksheet.",
        evaluatedBy: "local" as const,
        latencyMs: 0,
      };
      next[it.id] = { correct: r.correct, score: r.score, feedback: r.feedback };
      void markSubmitted(
        auth.user?.id ?? null,
        it.id,
        it.topicId,
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

  if (!lemma) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  if (!loading && !item) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={36} />
        <h1 className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
          {`"${lemma}" isn't in your deck yet.`}
        </h1>
        <Link
          href="/vocabulary"
          className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Back to vocabulary
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
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
            onClick={() => router.push("/vocabulary")}
            className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-line"
          >
            ← Vocabulary
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            disabled={items.length === 0}
            className="rounded-full border border-line bg-paper px-4 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2 disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
          <button
            onClick={() => item && generateWorksheet(item)}
            disabled={generating || !item}
            className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Fresh worksheet"}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-10 print:py-6">
        <div className="mb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            Worksheet · {item?.cefrLevel ?? ""} · vocabulary
          </p>
          <h1 className="mt-2 font-serif text-3xl font-medium tracking-[-0.02em] text-ink">
            {item?.gender && <span className="text-mute">{item.gender} </span>}
            {lemma}
            {item?.plural && (
              <span className="ml-2 font-serif text-sm text-mute">
                · pl. {item.plural}
              </span>
            )}
          </h1>
          {item && (
            <p className="mt-1 text-sm italic text-ink-2">{item.l1Translation}</p>
          )}
          <p className="mt-3 text-[11px] text-mute">
            Fill in each blank with the right form of <span className="font-medium">{lemma}</span>.
            {batchId && <span> · Batch {batchId.slice(0, 8)}</span>}
          </p>
        </div>

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
            Couldn&apos;t generate a worksheet for this word. Try again.
          </p>
        ) : (
          <ol className="space-y-5">
            {items.map((it, idx) => {
              const result = results?.[it.id];
              const prompt = typeof it.payload.prompt === "string" ? it.payload.prompt : "";
              const hint = typeof it.payload.hint === "string" ? it.payload.hint : "";
              return (
                <li
                  key={it.id}
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
                      value={answers[it.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [it.id]: e.target.value }))
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
                          {typeof it.payload.expectedAnswer === "string"
                            ? it.payload.expectedAnswer
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
              onClick={() => item && generateWorksheet(item)}
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
