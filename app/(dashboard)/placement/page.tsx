"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CefrLevel } from "@/types";

interface PlacementPrompt {
  index: number;
  level: CefrLevel;
  prompt: string;
}

const LEVEL_COLORS: Record<CefrLevel, string> = {
  A1: "bg-green-500", A2: "bg-emerald-500", B1: "bg-blue-500",
  B2: "bg-indigo-500", C1: "bg-purple-500", C2: "bg-rose-500",
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
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading placement test...</p>
      </div>
    );
  }

  // Phase 1: Ask native language
  if (phase === "language") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="text-4xl">👋</div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to GrammarCoach</h1>
          <p className="text-sm text-gray-500">
            Before we start, let&apos;s find out your current German level.
            First, what&apos;s your native language?
          </p>
          <div className="flex gap-3">
            <input
              value={nativeLanguage}
              onChange={(e) => setNativeLanguage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. English, Turkish, Bengali..."
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              onClick={handleLanguageSubmit}
              disabled={!nativeLanguage.trim()}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
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
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="text-5xl">🎯</div>
          <h1 className="text-2xl font-bold text-gray-900">Your Level</h1>
          <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold text-white ${LEVEL_COLORS[result.assignedLevel]}`}>
            {result.assignedLevel}
          </div>
          <p className="text-sm text-gray-500">
            Based on your answers (score: {result.totalScore}%), we recommend
            starting at <span className="font-semibold">{result.assignedLevel}</span>.
            Your learning path has been personalized!
          </p>
          <button
            onClick={() => router.push("/progress")}
            className="rounded-xl bg-indigo-600 px-8 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            View My Learning Plan
          </button>
        </div>
      </div>
    );
  }

  // Phase 2: Test questions
  const currentPrompt = prompts[currentIdx];
  const progressPct = Math.round((currentIdx / prompts.length) * 100);

  return (
    <div className="flex flex-1 flex-col">
      {/* Progress bar */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-lg">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
            <span>Placement Test</span>
            <span>{currentIdx + 1} / {prompts.length}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${LEVEL_COLORS[currentPrompt.level]}`}>
              {currentPrompt.level}
            </span>
            <span className="text-xs text-gray-400">Question {currentIdx + 1}</span>
          </div>

          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <p className="text-base font-medium text-gray-800">{currentPrompt.prompt}</p>
          </div>

          {submitting ? (
            <div className="text-center text-sm text-gray-400">
              Evaluating your answers...
            </div>
          ) : (
            <div className="flex gap-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                autoFocus
                className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                onClick={handleAnswer}
                disabled={!input.trim()}
                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
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
