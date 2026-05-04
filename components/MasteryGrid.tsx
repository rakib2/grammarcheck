"use client";

import { useMemo } from "react";
import Link from "next/link";
import { LearnerModel, CefrLevel } from "@/types";
import { GRAMMAR_STRUCTURES, StructureDefinition } from "@/lib/grammarStructures";
import { CEFR_LEVELS } from "@/lib/curriculum";

/**
 * MasteryGrid — colored CEFR-grouped grid of grammar structures.
 *
 * Extracted from the (now-merged) /mastery page so the same visual sits at
 * the top of /progress. The `onlyTouched` flag filters to structures with
 * `attempts > 0`, which is the default on the merged Overview surface — a
 * blank canvas of "not seen" boxes adds noise without information. The
 * full list (including unseen) is still available by passing
 * `onlyTouched={false}`.
 */

const LEVEL_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

interface CellState {
  def: StructureDefinition;
  mastery: number;
  attempts: number;
  isLocked: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
}

function masteryToIntensity(mastery: number, attempts: number): 0 | 1 | 2 | 3 | 4 {
  if (attempts === 0) return 0;
  if (mastery < 0.3) return 1;
  if (mastery < 0.6) return 2;
  if (mastery < 0.85) return 3;
  return 4;
}

const INTENSITY: Record<
  0 | 1 | 2 | 3 | 4,
  { bg: string; color: string; borderColor: string }
> = {
  0: { bg: "#fbfaf6", color: "#6b6b73", borderColor: "#e7e6e1" },
  1: { bg: "#f3efe2", color: "#3d3d44", borderColor: "#e7e6e1" },
  2: { bg: "#e6decd", color: "#3d3d44", borderColor: "#dccfb6" },
  3: { bg: "#cbe0bd", color: "#16161a", borderColor: "#b6d2a4" },
  4: { bg: "#7fae6a", color: "#fafaf8", borderColor: "#7fae6a" },
};

const LOCK_STYLE: React.CSSProperties = {
  background:
    "repeating-linear-gradient(45deg,#fbfaf6,#fbfaf6 6px,#f3efe2 6px,#f3efe2 12px)",
  color: "#bdb9af",
  borderColor: "#e7e6e1",
};

const INTENSITY_LABEL: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "not seen",
  1: "learning",
  2: "developing",
  3: "strong",
  4: "mastered",
};

interface MasteryGridProps {
  model: LearnerModel | null;
  /** Filter to structures with attempts > 0. Default true. */
  onlyTouched?: boolean;
  /** Show the legend row above the grid. Default true. */
  showLegend?: boolean;
}

export default function MasteryGrid({
  model,
  onlyTouched = true,
  showLegend = true,
}: MasteryGridProps) {
  const detectedLevel = model?.detectedLevel ?? "A1";
  const detectedIdx = LEVEL_ORDER.indexOf(detectedLevel);

  const groupedByLevel = useMemo(() => {
    const groups: Record<CefrLevel, CellState[]> = {
      A1: [], A2: [], B1: [], B2: [], C1: [], C2: [],
    };
    for (const def of GRAMMAR_STRUCTURES) {
      const userStruct = model?.structures.find((s) => s.id === def.id);
      const mastery = userStruct?.mastery ?? 0;
      const attempts = userStruct?.attempts ?? 0;
      if (onlyTouched && attempts === 0) continue;
      const cellLevelIdx = LEVEL_ORDER.indexOf(def.cefrLevel);
      const isLocked = cellLevelIdx > detectedIdx + 1;
      const intensity = masteryToIntensity(mastery, attempts);
      groups[def.cefrLevel].push({ def, mastery, attempts, isLocked, intensity });
    }
    return groups;
  }, [model, detectedIdx, onlyTouched]);

  const hasAnyCells = LEVEL_ORDER.some((lvl) => (groupedByLevel[lvl] ?? []).length > 0);

  if (!hasAnyCells) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-paper-warm p-6 text-center text-sm text-mute">
        No structures touched yet. Start any lesson and the boxes light up here as you go.
      </div>
    );
  }

  return (
    <div>
      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-mute">
          {([1, 2, 3, 4] as const).map((i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-[3px] border"
                style={{ background: INTENSITY[i].bg, borderColor: INTENSITY[i].borderColor }}
              />
              {INTENSITY_LABEL[i]}
            </span>
          ))}
          {!onlyTouched && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-[3px] border"
                  style={{ background: INTENSITY[0].bg, borderColor: INTENSITY[0].borderColor }}
                />
                {INTENSITY_LABEL[0]}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-[3px] border"
                  style={LOCK_STYLE}
                />
                locked
              </span>
            </>
          )}
        </div>
      )}

      {LEVEL_ORDER.map((lvl) => {
        const cells = groupedByLevel[lvl] ?? [];
        if (cells.length === 0) return null;
        const meta = CEFR_LEVELS.find((l) => l.level === lvl);
        return (
          <section key={lvl} className="mt-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              {lvl} · {meta?.label ?? ""}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {cells.map((cell) => {
                const visual: React.CSSProperties = cell.isLocked
                  ? LOCK_STYLE
                  : {
                      background: INTENSITY[cell.intensity].bg,
                      color: INTENSITY[cell.intensity].color,
                      borderColor: INTENSITY[cell.intensity].borderColor,
                    };
                const labelExtra = cell.isLocked
                  ? "locked"
                  : cell.attempts === 0
                  ? "not seen yet"
                  : `${Math.round(cell.mastery * 100)}% mastery`;
                return (
                  <Link
                    key={cell.def.id}
                    href={`/study/${cell.def.id}`}
                    style={visual}
                    className="aspect-square rounded-lg border p-2 text-left transition-shadow hover:shadow-sm"
                    aria-label={`${cell.def.name} — ${labelExtra}`}
                  >
                    <p className="text-[10px] font-semibold leading-tight line-clamp-2">
                      {cell.def.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px]">
                      {cell.attempts === 0
                        ? cell.isLocked
                          ? "locked"
                          : "—"
                        : `${Math.round(cell.mastery * 100)}%`}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
