"use client";

/**
 * Loading / thinking indicator — the SVO mark animating in sequence.
 *
 * Three shapes pulse subject · verb · object at 1.4s. The verb (square) rotates
 * 45° at peak, mirroring how German moves the verb around. Used wherever the
 * tutor is generating a reply.
 *
 * The keyframes live in app/globals.css under `.grammarflow-thinking`.
 */

interface ThinkingMarkProps {
  label?: string | null;
  className?: string;
}

export default function ThinkingMark({ label, className = "" }: ThinkingMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2 text-gray-400 ${className}`}>
      <span className="grammarflow-thinking" aria-hidden="true">
        <span className="s" />
        <span className="v" />
        <span className="o" />
      </span>
      {label !== null && label !== undefined && <span>{label}</span>}
    </span>
  );
}
