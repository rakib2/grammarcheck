"use client";

/**
 * SVO mark — three-shape glyph (subject · verb · object).
 *
 * Used as a utility glyph and as the static frame of the thinking indicator.
 * For the animated loading version, see <ThinkingMark />.
 */

interface SvoMarkProps {
  size?: number;
  dark?: boolean;
  className?: string;
}

export default function SvoMark({ size = 24, dark = true, className = "" }: SvoMarkProps) {
  const ink = dark ? "#15151a" : "#fafaf8";
  const accent = "#7fae6a";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      className={className}
    >
      <circle cx="28" cy="60" r="13" fill={ink} />
      <rect x="51" y="51" width="18" height="18" rx="3" fill={accent} />
      <circle cx="92" cy="60" r="13" fill={ink} />
    </svg>
  );
}
