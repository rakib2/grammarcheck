"use client";

import type { GrammarTable as GrammarTableData } from "@/lib/grammarStructures";

/**
 * GrammarTable — renders a declension or conjugation table.
 *
 * Two display modes:
 *   - "full"    : the brief's /review layout. Bold row labels, monospaced
 *                 column headers, the highlighted cell uses warm-bg.
 *   - "compact" : sticky-note version for the home right rail (256px wide).
 *                 Same shape, smaller type, tighter padding.
 *
 * Pure presentation — caller passes the data structure.
 */

interface GrammarTableProps {
  table: GrammarTableData;
  mode?: "full" | "compact";
}

export default function GrammarTable({ table, mode = "full" }: GrammarTableProps) {
  const isCompact = mode === "compact";
  const { columns, rows } = table;

  // Grid template: leading label column + N data columns
  const gridCols = `minmax(${isCompact ? "44px" : "64px"}, auto) repeat(${columns.length}, minmax(0, 1fr))`;

  const cellPadX = isCompact ? "px-1.5" : "px-3";
  const cellPadY = isCompact ? "py-1" : "py-2";
  const headerText = isCompact ? "text-[9px]" : "text-[11px]";
  const labelText = isCompact ? "text-[10px]" : "text-[12px]";
  const cellText = isCompact ? "text-[11px]" : "text-[13px]";

  return (
    <div
      className="overflow-hidden rounded-lg border border-line bg-paper"
      role="table"
      aria-label="Grammar reference table"
    >
      {/* Header row */}
      <div
        className="grid bg-line-2"
        style={{ gridTemplateColumns: gridCols }}
        role="row"
      >
        <div
          className={`${cellPadX} ${cellPadY} ${headerText} font-mono uppercase tracking-[0.08em] text-mute`}
          role="columnheader"
        />
        {columns.map((col) => (
          <div
            key={col}
            className={`${cellPadX} ${cellPadY} ${headerText} font-mono uppercase tracking-[0.08em] text-mute`}
            role="columnheader"
          >
            {col}
          </div>
        ))}
      </div>

      {/* Body rows */}
      {rows.map((row, rIdx) => (
        <div
          key={row.label}
          className={`grid ${rIdx > 0 ? "border-t border-line" : ""}`}
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          <div
            className={`${cellPadX} ${cellPadY} ${labelText} bg-line-2 font-semibold text-ink-2`}
            role="rowheader"
          >
            {row.label}
          </div>
          {row.cells.map((cell, cIdx) => (
            <div
              key={`${row.label}-${cIdx}`}
              className={`${cellPadX} ${cellPadY} ${cellText} ${
                cell.highlight ? "bg-warm-bg font-semibold text-ink" : "text-ink-2"
              }`}
              role="cell"
            >
              {cell.value}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
