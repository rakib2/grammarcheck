"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VocabularyItem } from "@/types";
import { getDueVocabulary, getNewVocabulary } from "@/lib/vocabulary";
import { loadVocabulary } from "@/lib/vocabularySync";
import { useAuth } from "@/lib/AuthContext";

/**
 * VocabCard — right-rail card on / showing today's vocab pulse.
 *
 * Renders three honest counts (due / new / total) and a CTA into /vocabulary.
 * Self-loads from localStorage so the home page doesn't need to know about
 * the deck.
 */

export default function VocabCard() {
  const auth = useAuth();
  const [deck, setDeck] = useState<VocabularyItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadVocabulary(auth.user?.id ?? null).then((items) => {
      if (cancelled) return;
      setDeck(items);
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  if (!mounted) {
    return (
      <div className="rounded-xl border border-line bg-paper p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
          Vocabulary
        </p>
      </div>
    );
  }

  const due = getDueVocabulary(deck).length;
  const fresh = getNewVocabulary(deck).length;
  const total = deck.length;

  return (
    <Link
      href="/vocabulary"
      className="block rounded-xl border border-line bg-paper p-4 transition-colors hover:bg-paper-warm"
    >
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
          Vocabulary
        </p>
        <span className="text-[10px] text-mute">{total} word{total === 1 ? "" : "s"}</span>
      </div>
      {total === 0 ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          Build a deck — the coach proposes words at your level.
        </p>
      ) : (
        <>
          <p className="mt-2 font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
            {due > 0 ? `${due} due` : "All caught up"}
          </p>
          <p className="mt-0.5 text-[11px] text-mute">
            {due === 0
              ? fresh > 0
                ? `${fresh} new card${fresh === 1 ? "" : "s"} ready`
                : "Spaced repetition is doing its job."
              : fresh > 0
              ? `${fresh} new + ${due - fresh > 0 ? `${due - fresh} review` : "review"}`
              : "review and stay sharp"}
          </p>
        </>
      )}
    </Link>
  );
}
