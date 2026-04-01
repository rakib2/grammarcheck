"use client";

import { Token } from "@/types";

interface GrammarCorrectionProps {
  tokens: Token[];
  score: number;
  errorTypes: string[];
}

const statusStyles: Record<Token["status"], string> = {
  correct: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  wrong: "bg-red-100 text-red-800 line-through",
  tip: "bg-blue-100 text-blue-800",
};

export default function GrammarCorrection({
  tokens,
  score,
  errorTypes,
}: GrammarCorrectionProps) {
  const fixTokens = tokens.filter(
    (t) => (t.status === "warn" || t.status === "wrong") && t.correction
  );
  const correctCount = tokens.filter((t) => t.status === "correct").length;
  const pct = tokens.length > 0 ? Math.round((correctCount / tokens.length) * 100) : 0;

  return (
    <div className="w-full max-w-2xl space-y-3">
      {/* Token row */}
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((token, i) => (
          <span
            key={i}
            className={`inline-block rounded px-2 py-1 text-sm font-medium ${statusStyles[token.status]}`}
          >
            {token.word}
          </span>
        ))}
      </div>

      {/* Corrections — what went wrong and how to fix it */}
      {fixTokens.length > 0 && (
        <div className="space-y-1.5">
          {fixTokens.map((token, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 font-medium ${
                token.status === "wrong"
                  ? "bg-red-100 text-red-700 line-through"
                  : "bg-amber-100 text-amber-700"
              }`}>
                {token.word}
              </span>
              <span className="text-gray-400">→</span>
              <span className="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">
                {token.correction}
              </span>
              {token.rule && (
                <span className="text-xs text-gray-400">{token.rule}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Correctness — single clean line */}
      <p className="text-xs text-gray-400">
        {pct}% correct ({correctCount}/{tokens.length} words)
      </p>
    </div>
  );
}
