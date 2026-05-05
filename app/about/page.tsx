import Link from "next/link";
import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import ContactForm from "@/components/ContactForm";

/**
 * Public about page. Companion to /landing.
 *
 * Tone matches the marketing landing — minimal, anti-gamification,
 * voice-first. Used for human readers and as a categorization signal
 * for corporate web filters that gate uncategorized domains.
 */

export const metadata: Metadata = {
  title: "About — GrammarFlow",
  description:
    "GrammarFlow is a voice-first German grammar coach built in Düsseldorf. Catches the structures you keep getting wrong, walks you through them, tracks what you've actually mastered.",
};

export default function AboutPage() {
  return (
    <main className="bg-bg text-ink">
      <Header />
      <Hero />
      <WhatThisIs />
      <WhatItDoes />
      <WhoBuildsIt />
      <DataAndPrivacy />
      <Contact />
      <Footer />
    </main>
  );
}

// ── Header ──────────────────────────────────────────────────────

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/landing" className="flex items-center gap-2">
          <BrandMark size={24} />
          <span className="font-serif text-lg font-medium tracking-[-0.01em] text-ink">
            GrammarFlow
          </span>
          <span className="ml-2 hidden rounded-full border border-line bg-paper-warm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-mute md:inline-block">
            Private beta · German
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-[13px] text-ink-2 md:flex">
          <Link href="/landing#how" className="transition-colors hover:text-ink">
            How it works
          </Link>
          <Link href="/landing#why" className="transition-colors hover:text-ink">
            Why a tutor
          </Link>
          <Link href="/about" className="text-ink transition-colors">
            About
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-full px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-line-2 hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
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

// ── Who builds it ───────────────────────────────────────────────

function WhoBuildsIt() {
  return (
    <section className="border-b border-line bg-paper-warm">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          Who builds it
        </p>
        <h2 className="mt-3 font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-ink md:text-[36px]">
          An independent project, made in Düsseldorf.
        </h2>
        <div className="mt-6 space-y-4 text-[16px] leading-relaxed text-ink-2">
          <p>
            GrammarFlow is a small, independent project based in Düsseldorf,
            Germany. It&apos;s currently in private beta. We&apos;re starting
            with German because its grammar is precise enough to teach this way
            — cases, articles, word order, separable verbs. Other languages
            later, only when we&apos;re sure we won&apos;t water down what
            works.
          </p>
          <p>
            No VC pressure, no growth-at-all-costs, no notification spam. Just
            a tool we&apos;d want to use ourselves.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Data & privacy ──────────────────────────────────────────────

function DataAndPrivacy() {
  return (
    <section className="border-b border-line bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          How your data is handled
        </p>
        <h2 className="mt-3 font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-ink md:text-[36px]">
          Boring. Which is the point.
        </h2>
        <div className="mt-6 space-y-4 text-[16px] leading-relaxed text-ink-2">
          <p>
            Your practice sessions and progress are stored in Supabase
            (PostgreSQL). Grammar feedback is generated using the Anthropic
            Claude and OpenAI APIs — your sentences are sent to those models to
            produce corrections, and not used for training.
          </p>
          <p>
            We don&apos;t sell your data, run third-party ads, or share it with
            anyone outside the processors above. You can delete your account
            and associated data at any time by emailing us.
          </p>
          <p>
            A full privacy policy and imprint will live alongside this page as
            we exit beta.
          </p>
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

// ── Footer ──────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-line bg-bg">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Link href="/landing" className="flex items-center gap-2">
            <BrandMark size={20} />
            <span className="font-serif text-base font-medium tracking-[-0.01em] text-ink">
              GrammarFlow
            </span>
          </Link>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-ink-2">
            A tutor for your German grammar. Voice-first, mistake-aware, calm.
          </p>
        </div>
        <FooterColumn
          heading="Product"
          links={[
            { href: "/landing#how", label: "How it works" },
            { href: "/landing#why", label: "Why a tutor" },
            { href: "/landing#languages", label: "Languages" },
            { href: "/about", label: "About" },
          ]}
        />
        <FooterColumn
          heading="Account"
          links={[
            { href: "/signup", label: "Start free" },
            { href: "/login", label: "Log in" },
          ]}
        />
        <FooterColumn
          heading="Legal"
          links={[
            { href: "#", label: "Privacy" },
            { href: "#", label: "Terms" },
            { href: "#", label: "Imprint" },
          ]}
        />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-5 text-[12px] text-mute md:flex-row md:items-center">
          <p>© 2026 GrammarFlow · grammarflow.io</p>
          <p>Made with care · Düsseldorf</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">
        {heading}
      </p>
      <ul className="mt-3 space-y-1.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="text-[13px] text-ink-2 transition-colors hover:text-ink"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
