"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LearnerModel,
  VocabularyItem,
  VocabularyGrade,
  VocabularyPos,
  CefrLevel,
} from "@/types";
import { useAuth } from "@/lib/AuthContext";
import { loadLearnerModel } from "@/lib/learnerModelSync";
import {
  getDueVocabulary,
  gradeVocabulary,
  upsertVocabulary,
  newVocabularyItem,
} from "@/lib/vocabulary";
import {
  loadVocabulary,
  saveVocabularyDeck,
  upsertVocabularyItem,
  removeVocabularyItem,
} from "@/lib/vocabularySync";
import BrandMark from "@/components/BrandMark";
import VocabItemCard from "@/components/VocabItemCard";

/**
 * Vocabulary — the learner's personal deck.
 *
 * Three sections:
 *   1. "Today's deck" — flashcard review for items due today (SRS).
 *   2. "Add today's words" — POSTs to /api/vocabulary/propose for AI suggestions
 *      and lets the learner accept individual cards into their deck.
 *   3. "All words" — the full deck, with mastery and next-due metadata.
 */

interface ProposalDraft {
  lemma: string;
  inflection?: string;
  partOfSpeech: VocabularyPos;
  gender?: "der" | "die" | "das";
  plural?: string;
  cefrLevel: CefrLevel;
  exampleSentence: string;
  l1Translation: string;
  structureId?: string;
}

const POS_LABEL: Record<VocabularyPos, string> = {
  noun: "noun",
  verb: "verb",
  adjective: "adj.",
  adverb: "adv.",
  preposition: "prep.",
  particle: "particle",
  phrase: "phrase",
};

function formatDue(dueAt: string, now: Date = new Date()): string {
  const t = new Date(dueAt).getTime();
  const diff = Math.round((t - now.getTime()) / 86_400_000);
  if (diff <= 0) return "due today";
  if (diff === 1) return "due tomorrow";
  if (diff < 7) return `due in ${diff} days`;
  return `due in ${Math.round(diff / 7)}w`;
}

function masteryFromItem(item: VocabularyItem): number {
  // Simple heuristic: repetitions clamped at 5 → 0–100%, lapses subtract 10% each.
  const base = Math.min(1, item.repetitions / 5);
  const penalty = Math.min(0.5, item.lapses * 0.1);
  return Math.max(0, Math.min(1, base - penalty));
}

export default function VocabularyPage() {
  const auth = useAuth();
  const [model, setModel] = useState<LearnerModel | null>(null);
  const [deck, setDeck] = useState<VocabularyItem[]>([]);
  const [proposals, setProposals] = useState<ProposalDraft[] | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Review state
  const [reviewIdx, setReviewIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Filter / search state for the deck grid. CEFR + POS chip toggles plus a
  // free-text search across lemma + l1Translation. Stored in plain state —
  // no need to hit URL params for a deck filter.
  const [filterLevels, setFilterLevels] = useState<Set<CefrLevel>>(new Set());
  const [filterPos, setFilterPos] = useState<Set<VocabularyPos>>(new Set());
  const [search, setSearch] = useState("");
  // Default to card grid — quick-revision list is one tap away. Choice
  // persisted across visits. Cache key bumped to v2 because the previous
  // default was "list" and that auto-saved on first paint, so v1 values
  // are rarely a real user preference.
  const [view, setView] = useState<"list" | "grid">("grid");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vocabularyView_v2");
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("vocabularyView_v2", view); } catch {}
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    const userId = auth.user?.id ?? null;
    // Supabase-first; falls back to localStorage on failure / signed-out
    loadVocabulary(userId).then((items) => {
      if (cancelled) return;
      setDeck(items);
      setHydrated(true);
    });
    loadLearnerModel(userId).then((m) => {
      if (!cancelled) setModel(m);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.user?.id]);

  const due = useMemo(() => getDueVocabulary(deck), [deck]);
  const totalCount = deck.length;
  const knownLemmas = useMemo(() => deck.map((d) => d.lemma), [deck]);

  // Reset review index if deck shrinks
  useEffect(() => {
    if (reviewIdx >= due.length) setReviewIdx(0);
  }, [due.length, reviewIdx]);

  /** Single-item update — fast path. */
  function persistOne(updated: VocabularyItem) {
    setDeck((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    void upsertVocabularyItem(updated, auth.user?.id ?? null);
  }

  /** Full-deck replace — for batch ops (accept-all, dismiss-all, remove). */
  function persistDeck(next: VocabularyItem[]) {
    setDeck(next);
    void saveVocabularyDeck(next, auth.user?.id ?? null);
  }

  function handleGrade(grade: VocabularyGrade) {
    const card = due[reviewIdx];
    if (!card) return;
    const updated = gradeVocabulary(card, grade);
    persistOne(updated);
    setRevealed(false);
    // Stay on the same index — getDueVocabulary will recompute and the next
    // unreviewed card will slide in. If nothing is due, this lands on 0.
    setReviewIdx((i) => (i >= due.length - 1 ? 0 : i));
  }

  async function handleProposeNew() {
    if (!model) return;
    setProposing(true);
    setProposeError(null);
    setProposals(null);
    try {
      const res = await fetch("/api/vocabulary/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: model.detectedLevel,
          nativeLanguage: model.nativeLanguage,
          count: 6,
          existingLemmas: knownLemmas,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: ProposalDraft[] };
      setProposals(data.items ?? []);
    } catch (err) {
      setProposeError(
        err instanceof Error ? err.message : "Could not load proposals"
      );
    } finally {
      setProposing(false);
    }
  }

  function handleAcceptProposal(p: ProposalDraft) {
    const item = newVocabularyItem(p);
    // Single-item add: optimistic state update + targeted upsert (cheaper
    // than rewriting the whole deck row-by-row to Supabase)
    setDeck((prev) => upsertVocabulary(prev, [item]));
    void upsertVocabularyItem(item, auth.user?.id ?? null);
    setProposals((prev) => prev?.filter((x) => x.lemma !== p.lemma) ?? null);
  }

  function handleAcceptAllProposals() {
    if (!proposals) return;
    const items = proposals.map((p) => newVocabularyItem(p));
    persistDeck(upsertVocabulary(deck, items));
    setProposals([]);
  }

  function handleRemove(id: string) {
    setDeck((prev) => prev.filter((d) => d.id !== id));
    void removeVocabularyItem(id, auth.user?.id ?? null);
  }

  // First-paint guard to avoid hydration flicker (deck is client-only)
  if (!hydrated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg">
        <p className="text-sm text-mute">Loading…</p>
      </div>
    );
  }

  const currentCard = due[reviewIdx] ?? null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">GrammarFlow</span>
          <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
            Vocabulary · {totalCount} word{totalCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        {/* Hero */}
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Vocabulary
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          {due.length > 0
            ? `${due.length} word${due.length === 1 ? "" : "s"} ready to review.`
            : totalCount === 0
            ? "Build a personal deck."
            : "All caught up."}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-ink-2">
          The coach proposes words at your level, you keep what looks useful, and
          spaced repetition surfaces them again before you forget. Keeps the new
          vocabulary tied to the grammar you&apos;re actually working on.
        </p>

        {/* Review section */}
        <section className="mt-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            Today&apos;s deck
          </p>
          {currentCard ? (
            <article className="mt-3 rounded-2xl border border-line bg-paper-warm p-7">
              <div className="flex items-baseline justify-between text-[11px] text-mute">
                <span className="font-mono uppercase tracking-[0.08em]">
                  {currentCard.cefrLevel} · {POS_LABEL[currentCard.partOfSpeech]}
                </span>
                <span>
                  {reviewIdx + 1} of {due.length}
                </span>
              </div>
              <p className="mt-4 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
                {currentCard.gender ? (
                  <span className="text-mute">{currentCard.gender} </span>
                ) : null}
                {currentCard.lemma}
                {currentCard.plural ? (
                  <span className="ml-2 font-serif text-base text-mute">
                    · pl. {currentCard.plural}
                  </span>
                ) : null}
              </p>
              {currentCard.inflection && (
                <p className="mt-1 text-sm text-mute">also: {currentCard.inflection}</p>
              )}

              {revealed ? (
                <div className="mt-6 space-y-3">
                  <p className="rounded-xl border border-line bg-paper px-4 py-3 text-base leading-relaxed text-ink">
                    {currentCard.exampleSentence}
                  </p>
                  <p className="text-sm italic text-ink-2">
                    {currentCard.l1Translation}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {(["again", "hard", "good", "easy"] as VocabularyGrade[]).map(
                      (g) => (
                        <button
                          key={g}
                          onClick={() => handleGrade(g)}
                          className={`rounded-full px-4 py-2 text-xs font-medium capitalize transition-opacity hover:opacity-90 ${
                            g === "again"
                              ? "bg-warn-ink text-paper"
                              : g === "hard"
                              ? "bg-warm-ink text-paper"
                              : g === "good"
                              ? "bg-ink text-paper"
                              : "bg-good-ink text-paper"
                          }`}
                        >
                          {g}
                        </button>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setRevealed(true)}
                  className="mt-6 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                >
                  Reveal example
                </button>
              )}
            </article>
          ) : (
            <div className="mt-3 rounded-2xl border border-dashed border-line bg-paper-warm p-7 text-center">
              <p className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
                {totalCount === 0
                  ? "Your deck is empty."
                  : "Nothing due — come back tomorrow."}
              </p>
              <p className="mt-2 text-sm text-mute">
                {totalCount === 0
                  ? "Generate today's words below to start your deck."
                  : "Spaced repetition is doing its job."}
              </p>
            </div>
          )}
        </section>

        {/* Propose new words */}
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Add today&apos;s words
            </p>
            {model && (
              <span className="text-[11px] text-mute">
                level {model.detectedLevel}
              </span>
            )}
          </div>
          <p className="mt-2 max-w-xl text-sm text-ink-2">
            The coach picks a small batch of useful words at your level. Keep
            what fits, skip the rest.
          </p>

          {proposals === null ? (
            <button
              onClick={handleProposeNew}
              disabled={proposing || !model}
              className="mt-4 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {proposing ? "Thinking…" : "Propose 6 words"}
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              {proposals.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line bg-paper-warm p-4 text-sm text-mute">
                  Nothing pending. Generate another batch?
                </p>
              ) : (
                <>
                  <ul className="space-y-2">
                    {proposals.map((p) => (
                      <li
                        key={p.lemma}
                        className="rounded-xl border border-line bg-paper p-4"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-serif text-xl font-medium tracking-[-0.01em] text-ink">
                            {p.gender ? (
                              <span className="text-mute">{p.gender} </span>
                            ) : null}
                            {p.lemma}
                            {p.plural ? (
                              <span className="ml-2 font-serif text-sm text-mute">
                                · pl. {p.plural}
                              </span>
                            ) : null}
                          </p>
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
                            {p.cefrLevel} · {POS_LABEL[p.partOfSpeech]}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-ink">{p.exampleSentence}</p>
                        <p className="mt-1 text-sm italic text-ink-2">{p.l1Translation}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => handleAcceptProposal(p)}
                            className="rounded-full bg-ink px-4 py-1.5 text-[11px] font-medium text-paper transition-opacity hover:opacity-90"
                          >
                            Add to deck
                          </button>
                          <button
                            onClick={() =>
                              setProposals((prev) =>
                                prev?.filter((x) => x.lemma !== p.lemma) ?? null
                              )
                            }
                            className="rounded-full border border-line bg-paper px-4 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-line-2"
                          >
                            Skip
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleAcceptAllProposals}
                      className="rounded-full bg-ink px-4 py-2 text-xs font-medium text-paper transition-opacity hover:opacity-90"
                    >
                      Add all {proposals.length}
                    </button>
                    <button
                      onClick={() => setProposals(null)}
                      className="rounded-full border border-line bg-paper px-4 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2"
                    >
                      Dismiss batch
                    </button>
                    <button
                      onClick={handleProposeNew}
                      disabled={proposing}
                      className="rounded-full border border-line bg-paper px-4 py-2 text-xs font-medium text-ink-2 transition-colors hover:bg-line-2 disabled:opacity-40"
                    >
                      {proposing ? "Thinking…" : "Propose more"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {proposeError && (
            <p className="mt-3 text-xs text-warn-ink">
              Couldn&apos;t load proposals: {proposeError}
            </p>
          )}
        </section>

        {/* All words — filterable grid of vocab cards. Replaces the previous
            alphabetical list with chip filters (CEFR + POS), free-text
            search, and per-card actions for review / practice / worksheet. */}
        {totalCount > 0 && (
          <VocabularyGrid
            deck={deck}
            filterLevels={filterLevels}
            filterPos={filterPos}
            search={search}
            view={view}
            onToggleLevel={(lvl) =>
              setFilterLevels((prev) => {
                const next = new Set(prev);
                if (next.has(lvl)) next.delete(lvl);
                else next.add(lvl);
                return next;
              })
            }
            onTogglePos={(pos) =>
              setFilterPos((prev) => {
                const next = new Set(prev);
                if (next.has(pos)) next.delete(pos);
                else next.add(pos);
                return next;
              })
            }
            onSearch={setSearch}
            onSetView={setView}
            onClearFilters={() => {
              setFilterLevels(new Set());
              setFilterPos(new Set());
              setSearch("");
            }}
            onRemove={handleRemove}
          />
        )}
      </div>
    </div>
  );
}

// ── Filter bar + card grid ──

const ALL_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ALL_POS: VocabularyPos[] = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "particle",
  "phrase",
];

interface VocabularyGridProps {
  deck: VocabularyItem[];
  filterLevels: Set<CefrLevel>;
  filterPos: Set<VocabularyPos>;
  search: string;
  view: "list" | "grid";
  onToggleLevel: (lvl: CefrLevel) => void;
  onTogglePos: (pos: VocabularyPos) => void;
  onSearch: (value: string) => void;
  onSetView: (v: "list" | "grid") => void;
  onClearFilters: () => void;
  onRemove: (id: string) => void;
}

function VocabularyGrid({
  deck,
  filterLevels,
  filterPos,
  search,
  view,
  onToggleLevel,
  onTogglePos,
  onSearch,
  onSetView,
  onClearFilters,
  onRemove,
}: VocabularyGridProps) {
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...deck]
      .filter((it) => {
        if (filterLevels.size > 0 && !filterLevels.has(it.cefrLevel)) return false;
        if (filterPos.size > 0 && !filterPos.has(it.partOfSpeech)) return false;
        if (term) {
          const haystack = `${it.lemma} ${it.l1Translation}`.toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => a.lemma.localeCompare(b.lemma, "de"));
  }, [deck, filterLevels, filterPos, search]);

  const hasFilters = filterLevels.size > 0 || filterPos.size > 0 || search.trim().length > 0;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
          All words ({filtered.length}
          {filtered.length !== deck.length ? ` of ${deck.length}` : ""})
        </p>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={onClearFilters}
              className="text-[11px] text-mute hover:text-ink-2"
            >
              Clear filters
            </button>
          )}
          <div className="flex overflow-hidden rounded-full border border-line text-[11px]">
            <button
              onClick={() => onSetView("list")}
              className={`px-2.5 py-1 transition-colors ${
                view === "list"
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink-2 hover:bg-line-2"
              }`}
              aria-pressed={view === "list"}
            >
              List
            </button>
            <button
              onClick={() => onSetView("grid")}
              className={`px-2.5 py-1 transition-colors ${
                view === "grid"
                  ? "bg-ink text-paper"
                  : "bg-paper text-ink-2 hover:bg-line-2"
              }`}
              aria-pressed={view === "grid"}
            >
              Cards
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar — chips for CEFR + POS, plus free-text search. */}
      <div className="mt-3 space-y-2 rounded-xl border border-line bg-paper p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
            Level
          </span>
          {ALL_LEVELS.map((lvl) => {
            const on = filterLevels.has(lvl);
            return (
              <button
                key={lvl}
                onClick={() => onToggleLevel(lvl)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  on
                    ? "bg-ink text-paper"
                    : "border border-line bg-paper text-ink-2 hover:bg-line-2"
                }`}
              >
                {lvl}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
            Type
          </span>
          {ALL_POS.map((pos) => {
            const on = filterPos.has(pos);
            return (
              <button
                key={pos}
                onClick={() => onTogglePos(pos)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                  on
                    ? "bg-ink text-paper"
                    : "border border-line bg-paper text-ink-2 hover:bg-line-2"
                }`}
              >
                {pos}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search lemma or translation…"
          className="w-full rounded-lg border border-line bg-paper-warm px-3 py-2 text-[13px] text-ink placeholder-mute outline-none focus:border-ink/30 focus:ring-2 focus:ring-line-2"
        />
      </div>

      {/* List or grid — list is default for fast scanning of large decks. */}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line bg-paper-warm p-6 text-center text-sm text-mute">
          No words match these filters.
        </p>
      ) : view === "grid" ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((it) => (
            <VocabItemCard
              key={it.id}
              item={it}
              onRemove={(item) => onRemove(item.id)}
            />
          ))}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-paper">
          {filtered.map((it) => (
            <VocabListRow
              key={it.id}
              item={it}
              onRemove={(item) => onRemove(item.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Compact list row ──

function masteryDot(item: VocabularyItem): { color: string; label: string } {
  if (item.repetitions === 0 && item.lapses === 0) return { color: "#e7e6e1", label: "untouched" };
  const m = masteryFromItem(item);
  if (m >= 0.85) return { color: "#7fae6a", label: "mastered" };
  if (m >= 0.6) return { color: "#b6d2a4", label: "strong" };
  if (m >= 0.3) return { color: "#dccfb6", label: "developing" };
  return { color: "#f3efe2", label: "learning" };
}

interface VocabListRowProps {
  item: VocabularyItem;
  onRemove: (item: VocabularyItem) => void;
}

function VocabListRow({ item, onRemove }: VocabListRowProps) {
  const dot = masteryDot(item);
  return (
    <li className="group flex items-center gap-3 px-3 py-2 transition-colors hover:bg-paper-warm">
      <span
        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-line"
        style={{ backgroundColor: dot.color }}
        aria-label={dot.label}
        title={dot.label}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {item.gender && <span className="text-mute">{item.gender} </span>}
          <span className="font-medium text-ink">{item.lemma}</span>
          {item.plural && (
            <span className="ml-1.5 text-[11px] text-mute">pl. {item.plural}</span>
          )}
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
            {item.cefrLevel} · {POS_LABEL[item.partOfSpeech]}
          </span>
        </p>
        <p className="truncate text-[11px] text-mute">
          {item.l1Translation} · {formatDue(item.dueAt)}
          {item.lapses > 0 ? ` · ${item.lapses}× forgotten` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
        <Link
          href={`/vocabulary/practice/${encodeURIComponent(item.lemma)}`}
          className="rounded-full border border-line bg-paper px-2.5 py-1 text-[10px] font-medium text-ink-2 transition-colors hover:bg-line-2"
        >
          Practice
        </Link>
        <Link
          href={`/worksheet/vocab/${encodeURIComponent(item.lemma)}`}
          className="rounded-full border border-line bg-paper px-2.5 py-1 text-[10px] font-medium text-ink-2 transition-colors hover:bg-line-2"
        >
          Worksheet
        </Link>
        <button
          onClick={() => onRemove(item)}
          className="rounded-full px-2 py-1 text-[10px] text-mute transition-colors hover:text-warn-ink"
          aria-label={`Remove ${item.lemma}`}
        >
          ×
        </button>
      </div>
    </li>
  );
}
