"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import GrammarTable from "@/components/GrammarTable";
import type { StructureDefinition } from "@/lib/grammarStructures";
import type { DynamicReferenceExample } from "@/lib/lessonEngine";
import type { CurriculumLesson } from "@/types";

interface LessonReferenceProps {
  /** Mapped grammar structure for this lesson. May be null — many lessons
   *  in the curriculum aren't yet linked into STRUCTURE_TO_LESSON, in which
   *  case we fall back to rendering the lesson's own teachContent. */
  structureDef: StructureDefinition | null;
  /** The active lesson — used to title the rail and as the source of the
   *  markdown fallback body when structureDef is missing or thin. */
  lesson?: CurriculumLesson | null;
  referenceExamples?: DynamicReferenceExample[];
  /**
   * Optional — when rendered inside a slide-in drawer, the parent supplies a
   * close handler so the user can dismiss without having to tap the backdrop.
   */
  onClose?: () => void;
}

/**
 * Always-visible grammar reference shown beside the chat during a lesson.
 *
 * - On lg+ desktops: rendered as a fixed-width right rail
 * - On smaller screens: rendered inside a slide-in drawer
 *
 * Content priority:
 *   1. structureDef.whyThisHappens + grammarTable (when mapped)
 *   2. lesson.teachContent rendered as markdown (fallback for unmapped lessons)
 *   3. Live examples from the pool batch (always shown when present)
 *
 * The fallback path matters: only ~half of curriculum lessons are linked
 * into STRUCTURE_TO_LESSON, so a meaningful right rail must work without a
 * structureDef.
 */
export default function LessonReference({
  structureDef,
  lesson,
  referenceExamples,
  onClose,
}: LessonReferenceProps) {
  // Pick the best header source. Prefer structureDef when mapped; otherwise
  // use the lesson's title/level so the rail still feels grounded.
  const headerTitle = structureDef?.name ?? lesson?.title ?? null;
  const headerLevel = structureDef?.cefrLevel ?? lesson?.cefrLevel ?? null;

  if (!headerTitle) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-mute">
        No reference available for this lesson.
      </div>
    );
  }

  // The rail uses structureDef body when it exists; otherwise it falls
  // through to the lesson's teachContent rendered as markdown. The two
  // never both render — they cover the same conceptual slot.
  const showStructureBody =
    !!structureDef && (!!structureDef.whyThisHappens || !!structureDef.grammarTable);
  const showTeachContent = !showStructureBody && !!lesson?.teachContent;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-baseline justify-between gap-2 border-b border-line bg-paper-warm px-5 py-3">
        <div className="min-w-0">
          {headerLevel && (
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
              Reference · {headerLevel}
            </p>
          )}
          <h2 className="mt-0.5 truncate font-serif text-base font-medium tracking-[-0.01em] text-ink">
            {headerTitle}
          </h2>
          {lesson?.grammarFocus && lesson.grammarFocus !== headerTitle && (
            <p className="mt-0.5 truncate text-[11px] text-mute">
              {lesson.grammarFocus}
            </p>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[11px] text-mute hover:bg-line-2 hover:text-ink-2"
            aria-label="Close reference"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-4">
          {showStructureBody && (
            <>
              {structureDef!.whyThisHappens && (
                <p className="text-[13px] leading-relaxed text-ink-2">
                  {structureDef!.whyThisHappens}
                </p>
              )}
              {structureDef!.grammarTable && (
                <GrammarTable table={structureDef!.grammarTable} mode="full" />
              )}
            </>
          )}

          {showTeachContent && (
            <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-ink-2 [&_h1]:font-serif [&_h1]:text-lg [&_h1]:font-medium [&_h1]:text-ink [&_h2]:font-serif [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-ink [&_h3]:font-medium [&_h3]:text-ink [&_strong]:font-semibold [&_strong]:text-ink [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:border-line [&_thead]:bg-line-2 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-mono [&_th]:text-[10px] [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-mute [&_td]:border-t [&_td]:border-line [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-[12px] [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_p]:my-2 [&_code]:rounded [&_code]:bg-line-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {lesson!.teachContent}
              </ReactMarkdown>
            </div>
          )}

          {referenceExamples && referenceExamples.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
                Live examples
              </p>
              <ul className="space-y-1.5">
                {referenceExamples.slice(0, 6).map((ex, i) => (
                  <li
                    key={`${ex.german}-${i}`}
                    className="rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-snug"
                  >
                    <span className="font-medium text-ink">{ex.german}</span>
                    {ex.translation && (
                      <span className="block text-ink-2">{ex.translation}</span>
                    )}
                    {ex.note && (
                      <span className="mt-0.5 block text-[11px] italic text-mute">
                        {ex.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
