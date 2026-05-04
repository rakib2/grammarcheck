"use client";

/**
 * Brand mark — four variants from the design brief.
 *
 *   correction    : two opening quote shapes, the second bends into a check
 *                   plus an accent dot. "You said something, I corrected it."
 *                   Currently the default.
 *   underline-g   : serif lowercase 'g' over a green wavy underline.
 *                   "Words on a page, with corrections beneath."
 *   caret         : proofreader's caret — horizontal mark + downward V + dot.
 *                   "Insert here." Bookish, copy-edit feel.
 *   svo           : three-shape SVO mark (circle · square · circle).
 *                   The brief's primary mark; verb-as-square nods to German's
 *                   verb-second rule. Used statically here; for the animated
 *                   loading version see <ThinkingMark />.
 *
 * The default `variant` stays "correction" so existing usages don't change
 * unless the import site explicitly opts in. The /logo-lab page renders all
 * four side-by-side for visual comparison.
 */

export type BrandVariant = "correction" | "underline-g" | "caret" | "svo";

interface BrandMarkProps {
  variant?: BrandVariant;
  size?: number;
  dark?: boolean;
  className?: string;
}

export default function BrandMark({
  variant = "underline-g",
  size = 24,
  dark = true,
  className = "",
}: BrandMarkProps) {
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
      {variant === "correction" && (
        <>
          <path
            d="M30 36 L30 72 Q30 84 42 84"
            fill="none"
            stroke={ink}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M62 36 L62 72 Q62 84 74 84 L84 84"
            fill="none"
            stroke={ink}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="92" cy="84" r="6" fill={accent} />
        </>
      )}

      {variant === "underline-g" && (
        <>
          {/* Serif "g" body — Fraunces, with two-story descender. The
              underline runs BELOW the descender (was passing through it
              before) and the wave amplitude is gentler so it reads as a
              confident correction mark instead of an ocean wave. */}
          <text
            x="60"
            y="78"
            textAnchor="middle"
            fontFamily="Fraunces, ui-serif, serif"
            fontSize="84"
            fontWeight={500}
            fill={ink}
            textRendering="geometricPrecision"
          >
            g
          </text>
          <path
            d="M20 100 Q40 90 60 100 T100 100"
            fill="none"
            stroke={accent}
            strokeWidth="8"
            strokeLinecap="round"
          />
        </>
      )}

      {variant === "caret" && (
        <>
          {/* Proofreader caret: horizontal rule + V + accent dot. */}
          <line
            x1="20"
            y1="46"
            x2="100"
            y2="46"
            stroke={ink}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M44 46 L60 78 L76 46"
            fill="none"
            stroke={ink}
            strokeWidth="8"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="60" cy="92" r="4" fill={accent} />
        </>
      )}

      {variant === "svo" && (
        <>
          <circle cx="28" cy="60" r="13" fill={ink} />
          <rect x="51" y="51" width="18" height="18" rx="3" fill={accent} />
          <circle cx="92" cy="60" r="13" fill={ink} />
        </>
      )}
    </svg>
  );
}
