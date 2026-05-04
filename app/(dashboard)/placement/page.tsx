"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CefrLevel } from "@/types";
import BrandMark from "@/components/BrandMark";

interface PlacementPrompt {
  index: number;
  level: CefrLevel;
  prompt: string;
}

const LEVEL_LABELS: Record<CefrLevel, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper Intermediate",
  C1: "Advanced",
  C2: "Mastery",
};

export default function PlacementPage() {
  const router = useRouter();
  const [prompts, setPrompts] = useState<PlacementPrompt[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<{ index: number; response: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    assignedLevel: CefrLevel;
    totalScore: number;
  } | null>(null);
  const [nativeLanguage, setNativeLanguage] = useState("");
  const [phase, setPhase] = useState<"language" | "test" | "result">("language");

  useEffect(() => {
    fetch("/api/placement")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts);
        setLoading(false);
      });
  }, []);

  function handleLanguageSubmit() {
    if (!nativeLanguage.trim()) return;
    setPhase("test");
  }

  function handleAnswer() {
    if (!input.trim()) return;
    const newAnswers = [...answers, { index: prompts[currentIdx].index, response: input.trim() }];
    setAnswers(newAnswers);
    setInput("");

    if (currentIdx + 1 < prompts.length) {
      setCurrentIdx(currentIdx + 1);
    } else {
      submitTest(newAnswers);
    }
  }

  async function submitTest(finalAnswers: { index: number; response: string }[]) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/placement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      const data = await res.json();
      setResult(data);
      setPhase("result");
    } catch {
      setResult({ assignedLevel: "A1", totalScore: 0 });
      setPhase("result");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (phase === "language") handleLanguageSubmit();
      else handleAnswer();
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading placement test…</p>
      </div>
    );
  }

  // Phase 1: Ask native language
  if (phase === "language") {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="flex justify-center">
            <BrandMark size={36} />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              Welcome
            </p>
            <h1 className="mt-2 font-serif text-3xl font-medium tracking-[-0.015em] text-ink">
              Let&apos;s find your level.
            </h1>
            <p className="mt-3 text-sm text-ink-2">
              Before we start, what&apos;s your native language? It helps the coach explain
              things in a way that fits how you already think.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={nativeLanguage}
              onChange={(e) => setNativeLanguage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. English, Turkish, Bengali"
              className="flex-1 rounded-xl border border-line bg-paper px-4 py-3 text-sm outline-none transition-colors focus:border-ink"
            />
            <button
              onClick={handleLanguageSubmit}
              disabled={!nativeLanguage.trim()}
              className="rounded-xl bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase 3: Show result
  if (phase === "result" && result) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="flex justify-center">
            <BrandMark size={36} />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              Your level
            </p>
            <h1 className="mt-2 font-serif text-5xl font-medium tracking-[-0.02em] text-ink">
              {result.assignedLevel}
            </h1>
            <p className="mt-1 text-sm text-mute">{LEVEL_LABELS[result.assignedLevel]}</p>
          </div>
          <p className="text-sm leading-relaxed text-ink-2">
            Based on your answers (score: {result.totalScore}%), we&apos;ll start you at{" "}
            <b className="text-ink">{result.assignedLevel}</b>. The coach will adapt as
            you go — nothing is locked.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => router.push("/")}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              Start a session
            </button>
            <button
              onClick={() => router.push("/progress")}
              className="rounded-full border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
            >
              See the grammar map
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase 2: Test questions
  const currentPrompt = prompts[currentIdx];
  const progressPct = Math.round((currentIdx / prompts.length) * 100);

  return (
    <div className="flex flex-1 flex-col bg-bg">
      {/* Progress bar */}
      <div className="border-b border-line bg-paper px-6 py-4">
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-center justify-between text-xs text-mute">
            <span className="font-mono uppercase tracking-[0.12em]">Placement test</span>
            <span>{currentIdx + 1} / {prompts.length}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
            <div
              className="h-full rounded-full bg-ink transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
              {currentPrompt.level} · {LEVEL_LABELS[currentPrompt.level]}
            </span>
            <span className="text-xs text-mute">Question {currentIdx + 1}</span>
          </div>

          <div className="rounded-xl border border-line bg-paper-warm p-6">
            <p className="font-serif text-2xl font-medium leading-snug tracking-[-0.01em] text-ink">
              {currentPrompt.prompt}
            </p>
          </div>

          {submitting ? (
            <div className="text-center text-sm text-mute">
              Evaluating your answers…
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer…"
                autoFocus
                className="flex-1 rounded-xl border border-line bg-paper px-4 py-3 text-sm outline-none transition-colors focus:border-ink"
              />
              <button
                onClick={handleAnswer}
                disabled={!input.trim()}
                className="rounded-xl bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {currentIdx + 1 < prompts.length ? "Next" : "Finish"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
