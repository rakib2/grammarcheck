"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import ThinkingMark from "@/components/ThinkingMark";
import { useAuth } from "@/lib/AuthContext";
import { evaluateLocally } from "@/lib/exercisePool";
import { loadVocabulary } from "@/lib/vocabularySync";
import type { PooledExercise, VocabularyItem } from "@/types";

/**
 * Per-word practice — a focused 4–5 item drill set for a single lemma.
 *
 * Generates once on mount, grades every item locally via {@link evaluateLocally}
 * (no LLM call on submit), and wraps with score + "try another / back to deck"
 * actions when the set is finished.
 *
 * The lemma comes from the URL (`/vocabulary/practice/<lemma>`); the
 * matching VocabularyItem is loaded from the user's deck so we can pass
 * gender / POS / example to the generator for richer context.
 */

type AnswerMap = Record<string, string>;
type ResultMap = Record<string, { correct: boolean; score: number; feedback: string }>;

export default function VocabPracticePage() {
  const params = useParams<{ lemma: string }>();
  const router = useRouter();
  const auth = useAuth();
  const lemma = useMemo(() => decodeURIComponent(params?.lemma ?? ""), [params?.lemma]);

  const [item, setItem] = useState<VocabularyItem | null>(null);
  const [exercises, setExercises] = useState<PooledExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [results, setResults] = useState<ResultMap | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setError(`"${lemma}" isn't in your deck yet.`);
        return;
      }
      await generatePractice(found);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lemma]);

  async function generatePractice(target: VocabularyItem) {
    setGenerating(true);
    setError(null);
    setResults(null);
    setAnswers({});
    try {
      const res = await fetch("/api/vocabulary/practice/generate", {
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
          itemCount: 5,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: PooledExercise[] };
      const fresh = data.items ?? [];
      if (fresh.length === 0) {
        setError("Couldn't generate practice items. Try again.");
        setExercises([]);
        return;
      }
      setExercises(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  function handleSubmit() {
    if (exercises.length === 0) return;
    const next: ResultMap = {};
    for (const ex of exercises) {
      const answer = (answers[ex.id] ?? "").trim();
      const local = evaluateLocally(ex.evalKind, ex.evalSpec, answer);
      next[ex.id] = local
        ? { correct: local.correct, score: local.score, feedback: local.feedback }
        : { correct: false, score: 0, feedback: "Couldn't grade locally — try again." };
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

  if (error && !item) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <BrandMark size={36} />
        <h1 className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
          {error}
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
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
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
          {item && (
            <Link
              href={`/worksheet/vocab/${encodeURIComponent(item.lemma)}`}
              className="rounded-full border border-line bg-paper px-4 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2"
            >
              Make a worksheet
            </Link>
          )}
          {item && (
            <button
              onClick={() => generatePractice(item)}
              disabled={generating}
              className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Fresh set"}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        {/* Word header */}
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Practice · {item?.cefrLevel ?? ""}
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          {item?.gender && <span className="text-mute">{item.gender} </span>}
          {lemma}
          {item?.plural && (
            <span className="ml-2 font-serif text-base text-mute">
              · pl. {item.plural}
            </span>
          )}
        </h1>
        {item && (
          <p className="mt-1 text-sm italic text-ink-2">{item.l1Translation}</p>
        )}

        {/* Score banner — only after submission */}
        {results && (
          <div className="mt-6 rounded-2xl border border-line bg-paper-warm p-4">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                Score
              </p>
              <p className="font-serif text-3xl font-medium text-ink">{totalScore}%</p>
            </div>
            <p className="mt-1 text-xs text-mute">
              {correctCount} of {exercises.length} correct.
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-12 flex justify-center">
            <ThinkingMark label="Generating practice set…" />
          </div>
        ) : exercises.length === 0 ? (
          <p className="mt-12 text-center text-sm text-mute">
            {error ?? "No practice items available."}
          </p>
        ) : (
          <ol className="mt-6 space-y-4">
            {exercises.map((ex, idx) => {
              const result = results?.[ex.id];
              const prompt = typeof ex.payload.prompt === "string" ? ex.payload.prompt : "";
              const hint = typeof ex.payload.hint === "string" ? ex.payload.hint : "";
              const expected =
                typeof ex.payload.expectedAnswer === "string"
                  ? ex.payload.expectedAnswer
                  : "";
              return (
                <li
                  key={ex.id}
                  className="rounded-xl border border-line bg-paper p-4"
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
                      value={answers[ex.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [ex.id]: e.target.value }))
                      }
                      disabled={!!results}
                      placeholder="answer"
                      className={`min-w-[160px] rounded-md border bg-paper px-2 py-1 text-sm focus:outline-none focus:ring-2 ${
                        result
                          ? result.correct
                            ? "border-good-ink/40 bg-good-bg text-good-ink ring-good-ink/30"
                            : "border-warn-ink/40 bg-warn-bg text-warn-ink ring-warn-ink/30"
                          : "border-line text-ink focus:ring-ink/20"
                      }`}
                    />
                    {hint && (
                      <span className="text-[11px] italic text-mute">({hint})</span>
                    )}
                    {result && !result.correct && expected && (
                      <span className="text-[11px] text-mute">
                        Expected:{" "}
                        <span className="font-medium text-good-ink">{expected}</span>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Actions */}
        {!loading && exercises.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-end gap-2">
            {!results ? (
              <button
                onClick={handleSubmit}
                className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
              >
                Check answers
              </button>
            ) : (
              <>
                <Link
                  href="/vocabulary"
                  className="rounded-full border border-line bg-paper px-5 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
                >
                  Back to deck
                </Link>
                <button
                  onClick={() => item && generatePractice(item)}
                  disabled={generating}
                  className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {generating ? "Generating…" : "Try another set"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
