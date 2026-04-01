"use client";

import { Token } from "@/types";

interface RuleCardProps {
  token: Token;
  index: number;
}

export default function RuleCard({ token, index }: RuleCardProps) {
  const delay = index * 120;

  return (
    <div
      className="rule-card-enter rounded-xl border border-gray-200 bg-white p-4"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Correction row */}
      {token.correction && (
        <div className="mb-3 flex items-center gap-3">
          <span className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
            token.status === "wrong"
              ? "bg-red-50 text-red-600 line-through"
              : "bg-amber-50 text-amber-600"
          }`}>
            {token.word}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
          <span className="rounded-lg bg-green-50 px-2.5 py-1 text-sm font-semibold text-green-700">
            {token.correction}
          </span>
        </div>
      )}

      {/* Rule explanation */}
      {token.rule && (
        <p className="text-sm leading-relaxed text-gray-600">
          {token.rule}
        </p>
      )}
    </div>
  );
}
