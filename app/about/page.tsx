import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/**
 * Public about page. Tone matches the marketing landing — minimal,
 * anti-gamification, voice-first. Used for human readers and as a
 * categorization signal for corporate web filters that gate
 * uncategorized domains.
 */

export const metadata: Metadata = {
  title: "About — GrammarFlow",
  description:
    "GrammarFlow is a voice-first German grammar coach. Catches the structures you keep getting wrong, walks you through them, tracks what you've actually mastered.",
};

export default function AboutPage() {
  return (
    <main className="bg-bg text-ink">
      <MarketingHeader activePath="/about" />
      <Hero />
      <WhatThisIs />
      <WhatItDoes />
      <Contact />
      <MarketingFooter showTagline={false} />
    </main>
  );
}

// ── Hero ────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="border-b border-line bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          About
        </p>
        <h1 className="mt-4 font-serif text-[40px] font-medium leading-[1.08] tracking-[-0.025em] text-ink md:text-[56px]">
          A tutor for your German grammar.
        </h1>
        <p className="mt-6 text-[16px] leading-relaxed text-ink-2 md:text-[17px]">
          GrammarFlow listens to you speak German, catches the grammar you keep
          getting wrong, and walks you through it — the way a real coach does.
          No streaks to game. No points to farm. Just the structures you&apos;ve
          mastered, the ones you haven&apos;t, and what to work on tomorrow.
        </p>
      </div>
    </section>
  );
}

// ── What this is ────────────────────────────────────────────────

function WhatThisIs() {
  return (
    <section className="border-b border-line bg-paper-warm">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          The premise
        </p>
        <h2 className="mt-3 font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-ink md:text-[36px]">
          Grammar isn&apos;t memorized.{" "}
          <em className="italic">It&apos;s demonstrated.</em>
        </h2>
        <div className="mt-6 space-y-4 text-[16px] leading-relaxed text-ink-2">
          <p>
            Most language apps measure you by streak length and vocabulary
            count. Both are easy to game and neither tells you whether you can
            actually use German in a real sentence.
          </p>
          <p>
            GrammarFlow is built around a different idea: a structure is
            mastered only when you produce it correctly across real
            conversations — not when you tap the right answer on a quiz. The
            whole product follows from that one premise.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── What it does ────────────────────────────────────────────────

function WhatItDoes() {
  const items = [
    {
      title: "It listens to you speak",
      body:
        "Voice-first conversation. Talk in German, the coach catches the grammar in real time and replies — no wall of red, no quizzes you forget by lunch.",
    },
    {
      title: "It remembers your patterns",
      body:
        "Cross-session mistake tracking. Your weak structures by name, with the exact sentences you slipped on and why. Surfaced again before you forget.",
    },
    {
      title: "It measures what matters",
      body:
        "23 grammar structures across CEFR A1–C1. The map fills in as you demonstrate each one in real conversation — not in a multiple-choice quiz.",
    },
    {
      title: "It coaches, not gamifies",
      body:
        "No streaks. No leaderboards. No notifications shaming you for missing a day. Just a quiet read on what you can do, and what to look at tomorrow.",
    },
  ];
  return (
    <section className="border-b border-line bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          What it does, exactly
        </p>
        <h2 className="mt-3 max-w-3xl font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-ink md:text-[36px]">
          Four things. That&apos;s the whole product.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {items.map((it) => (
            <div
              key={it.title}
              className="rounded-2xl border border-line bg-paper p-6"
            >
              <h3 className="font-serif text-xl font-medium tracking-[-0.01em] text-ink">
                {it.title}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                {it.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Contact ─────────────────────────────────────────────────────

function Contact() {
  return (
    <section className="border-b border-line bg-paper-warm">
      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
            Contact
          </p>
          <h2 className="mt-3 font-serif text-[36px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[44px]">
            Say hello.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
            Bug reports, feature requests, or just to tell us what you&apos;re
            working on in German.
          </p>
        </div>
        <div className="mt-10 rounded-2xl border border-line bg-paper p-6 md:p-8">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
