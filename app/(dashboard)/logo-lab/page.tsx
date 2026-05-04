"use client";

import BrandMark, { BrandVariant } from "@/components/BrandMark";
import ThinkingMark from "@/components/ThinkingMark";

/**
 * Logo lab — visual side-by-side preview of all four BrandMark variants.
 *
 * Test surface only. Pick the variant that wins, then change the default in
 * `components/BrandMark.tsx` (set `variant = "..."` on the prop) so every
 * existing usage picks it up. Doesn't write any state — every variant on
 * the page is rendered with an explicit `variant` prop.
 */

const VARIANTS: { id: BrandVariant; label: string; sub: string }[] = [
  {
    id: "correction",
    label: "01 · The Correction",
    sub: "Two quote shapes, second bends into a check + dot.",
  },
  {
    id: "underline-g",
    label: "02 · Underlined g",
    sub: "Serif 'g' over a green wavy correction underline.",
  },
  {
    id: "caret",
    label: "03 · Proofreader's Caret",
    sub: "Horizontal mark + V + dot — copy-edit feel.",
  },
  {
    id: "svo",
    label: "04 · SVO Three-shape",
    sub: "Circle · square · circle. Verb as square = German's V2 rule.",
  },
];

const SIZES = [18, 24, 40, 72];

export default function LogoLabPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-bg">
      <header className="flex items-center justify-between border-b border-line bg-paper px-6 py-3">
        <div className="flex items-center gap-3">
          <BrandMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">
            GrammarFlow
          </span>
          <span className="rounded-full bg-chip-bg px-2.5 py-0.5 text-[11px] font-medium text-ink-2">
            Logo lab
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
          Brand
        </p>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-[-0.02em] text-ink">
          Pick the mark that wins.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          Each variant rendered at favicon, sidebar, header, and large
          display sizes — plus a header lockup and the dark/light/mono
          treatment from the brief. Once you decide, tell me which and I&apos;ll
          set it as the default in <code className="rounded bg-line-2 px-1.5 py-0.5 text-[12px]">components/BrandMark.tsx</code>.
        </p>

        <div className="mt-10 space-y-8">
          {VARIANTS.map((v) => (
            <section key={v.id} className="rounded-2xl border border-line bg-paper p-6">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-serif text-xl font-medium tracking-[-0.01em] text-ink">
                    {v.label}
                  </p>
                  <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-2">
                    {v.sub}
                  </p>
                </div>
                <code className="rounded bg-line-2 px-2 py-1 text-[11px] text-mute">
                  variant=&quot;{v.id}&quot;
                </code>
              </div>

              {/* Size ladder */}
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {SIZES.map((s) => (
                  <div
                    key={s}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-bg p-4"
                  >
                    <BrandMark variant={v.id} size={s} />
                    <span className="font-mono text-[10px] text-mute">{s}px</span>
                  </div>
                ))}
              </div>

              {/* Header lockup */}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-bg p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                    Header lockup (light)
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <BrandMark variant={v.id} size={22} />
                    <span className="text-sm font-semibold tracking-[-0.01em] text-ink">
                      GrammarFlow
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-[#15151a] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-paper/60">
                    Header lockup (dark)
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <BrandMark variant={v.id} size={22} dark={false} />
                    <span className="text-sm font-semibold tracking-[-0.01em] text-paper">
                      GrammarFlow
                    </span>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        {/* Loading indicator preview — separate concern, but lives here too */}
        <section className="mt-12 rounded-2xl border border-line bg-paper p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            Loading indicator
          </p>
          <h2 className="mt-1 font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
            SVO mark, animated, small.
          </h2>
          <p className="mt-2 max-w-xl text-[13px] text-ink-2">
            Used wherever a response is being awaited — chat replies,
            worksheet generation, vocab practice. Stays at 8px so it never
            steals attention.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-6 rounded-xl border border-line bg-bg p-5">
            <ThinkingMark label="Checking…" />
            <ThinkingMark label="Generating…" />
            <ThinkingMark label={null} />
          </div>
        </section>
      </div>
    </div>
  );
}
