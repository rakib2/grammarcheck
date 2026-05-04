"use client";

import Link from "next/link";
import type { VocabularyItem, VocabularyPos } from "@/types";

/**
 * Per-word tile in the vocabulary grid.
 *
 * Tinted by SRS-derived mastery using the same TINT palette as
 * MasteryGrid / SkillTree / worksheet — so a learner skimming their deck
 * sees at a glance which words they own and which still need work.
 *
 * Three actions surface on every card:
 *   - Review       : opens the inline flashcard scoped to this lemma
 *   - Practice     : full-page drill set for this lemma
 *   - Worksheet    : single-word fill-in-the-blank sheet
 */

const POS_LABEL: Record<VocabularyPos, string> = {
  noun: "noun",
  verb: "verb",
  adjective: "adj.",
  adverb: "adv.",
  preposition: "prep.",
  particle: "particle",
  phrase: "phrase",
};

type Tint = "untouched" | "learning" | "developing" | "strong" | "mastered";

const TINT: Record<Tint, { bg: string; border: string; ring: string }> = {
  untouched:  { bg: "#fbfaf6", border: "#e7e6e1", ring: "#e7e6e1" },
  learning:   { bg: "#f3efe2", border: "#e7e6e1", ring: "#dccfb6" },
  developing: { bg: "#e6decd", border: "#dccfb6", ring: "#dccfb6" },
  strong:     { bg: "#cbe0bd", border: "#b6d2a4", ring: "#b6d2a4" },
  mastered:   { bg: "#7fae6a", border: "#7fae6a", ring: "#7fae6a" },
};

function masteryFromItem(item: VocabularyItem): number {
  const base = Math.min(1, item.repetitions / 5);
  const penalty = Math.min(0.5, item.lapses * 0.1);
  return Math.max(0, Math.min(1, base - penalty));
}

function masteryToTint(item: VocabularyItem): Tint {
  if (item.repetitions === 0 && item.lapses === 0) return "untouched";
  const m = masteryFromItem(item);
  if (m >= 0.85) return "mastered";
  if (m >= 0.6) return "strong";
  if (m >= 0.3) return "developing";
  return "learning";
}

function formatDue(dueAt: string, now: Date = new Date()): string {
  const t = new Date(dueAt).getTime();
  const diff = Math.round((t - now.getTime()) / 86_400_000);
  if (diff <= 0) return "due today";
  if (diff === 1) return "due tomorrow";
  if (diff < 7) return `due in ${diff} days`;
  return `due in ${Math.round(diff / 7)}w`;
}

interface VocabItemCardProps {
  item: VocabularyItem;
  /** Called when the card's "Review" pill is tapped — parent wires to flashcard. */
  onReview?: (item: VocabularyItem) => void;
  /** Called when "Remove" is tapped. */
  onRemove?: (item: VocabularyItem) => void;
}

export default function VocabItemCard({ item, onReview, onRemove }: VocabItemCardProps) {
  const tint = masteryToTint(item);
  const colors = TINT[tint];
  const isMastered = tint === "mastered";
  const masteryPct = Math.round(masteryFromItem(item) * 100);

  return (
    <div
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
      className="flex flex-col gap-2 rounded-xl border p-3 transition-shadow hover:shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className={`truncate font-serif text-lg font-medium tracking-[-0.01em] ${
          isMastered ? "text-paper" : "text-ink"
        }`}>
          {item.gender && (
            <span className={`text-sm ${isMastered ? "text-paper/80" : "text-mute"}`}>
              {item.gender}{" "}
            </span>
          )}
          {item.lemma}
        </p>
        <span className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] ${
          isMastered ? "text-paper/80" : "text-mute"
        }`}>
          {item.cefrLevel} · {POS_LABEL[item.partOfSpeech]}
        </span>
      </div>

      {item.plural && (
        <p className={`-mt-1 text-[11px] ${isMastered ? "text-paper/80" : "text-mute"}`}>
          pl. {item.plural}
        </p>
      )}

      <p className={`text-[12px] leading-snug line-clamp-2 ${
        isMastered ? "text-paper" : "text-ink-2"
      }`}>
        {item.exampleSentence}
      </p>
      <p className={`text-[11px] italic line-clamp-1 ${
        isMastered ? "text-paper/80" : "text-mute"
      }`}>
        {item.l1Translation}
      </p>

      <div className={`flex items-baseline justify-between text-[10px] ${
        isMastered ? "text-paper/80" : "text-mute"
      }`}>
        <span>{formatDue(item.dueAt)}</span>
        <span>{masteryPct}%</span>
      </div>

      <div className="mt-1 flex flex-wrap gap-1.5">
        {onReview && (
          <button
            onClick={() => onReview(item)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-opacity hover:opacity-80 ${
              isMastered ? "bg-paper text-ink" : "bg-ink text-paper"
            }`}
          >
            Review
          </button>
        )}
        <Link
          href={`/vocabulary/practice/${encodeURIComponent(item.lemma)}`}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
            isMastered
              ? "border-paper/40 text-paper hover:bg-paper/10"
              : "border-line bg-paper text-ink-2 hover:bg-line-2"
          }`}
        >
          Practice
        </Link>
        <Link
          href={`/worksheet/vocab/${encodeURIComponent(item.lemma)}`}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
            isMastered
              ? "border-paper/40 text-paper hover:bg-paper/10"
              : "border-line bg-paper text-ink-2 hover:bg-line-2"
          }`}
        >
          Worksheet
        </Link>
        {onRemove && (
          <button
            onClick={() => onRemove(item)}
            className={`ml-auto rounded-full px-2 py-1 text-[10px] transition-colors ${
              isMastered
                ? "text-paper/70 hover:text-paper"
                : "text-mute hover:text-warn-ink"
            }`}
            aria-label={`Remove ${item.lemma}`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
