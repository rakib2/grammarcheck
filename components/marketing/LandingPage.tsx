import Link from "next/link";
import GrammarTable from "@/components/GrammarTable";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";

/**
 * Public landing — rendered at `/`. Authed visitors are redirected to
 * `/practice` by RedirectIfAuthed so they don't sit on the marketing page.
 *
 * Tone: minimal, anti-gamification, voice-first. No claims that don't
 * match the actual shipped product (23 structures across A1–C1, no OAuth,
 * no streaks/leaderboards, German-only).
 */
export default function LandingPage() {
  return (
    <main className="bg-bg text-ink">
      <MarketingHeader />
      <Hero />
      <DemoStrip />
      <Difference />
      <HowItWorks />
      <PullQuote />
      <Compare />
      <GetStarted />
      <FinalCTA />
      <MarketingFooter />
    </main>
  );
}

// ── Hero ────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="border-b border-line bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          Voice-first German tutor
        </p>
        <h1 className="mt-4 max-w-4xl font-serif text-[44px] font-medium leading-[1.05] tracking-[-0.025em] text-ink md:text-[64px]">
          Not a language app.{" "}
          <em className="font-serif font-medium italic text-ink">A tutor</em>{" "}
          that measures progress like a human one would.
        </h1>
        <p className="mt-6 max-w-2xl text-[16px] leading-relaxed text-ink-2 md:text-[17px]">
          GrammarFlow listens to you speak German, catches the grammar you keep
          getting wrong, and walks you through it — the way a real coach does.
          No streaks to game. No points to farm. Just the structures you&apos;ve
          mastered, the ones you haven&apos;t, and what to work on tomorrow.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Start speaking — free
          </Link>
          <a
            href="#how"
            className="rounded-full border border-line bg-paper px-5 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
          >
            See how it works →
          </a>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-mute">
          {[
            "Voice-first",
            "23 structures · A1–C1",
            "CEFR-aligned",
            "No streaks",
          ].map((pill) => (
            <span key={pill} className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {pill}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Demo strip ──────────────────────────────────────────────────

function DemoStrip() {
  return (
    <section className="bg-paper-warm">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-[1.1fr_0.9fr] md:py-20">
        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            Today&apos;s warm-up · 3 sentences
          </p>
          <p className="font-serif text-2xl font-medium tracking-[-0.01em] text-ink">
            Tell me about your weekend — using Akkusativ.
          </p>

          <div className="mt-4 space-y-3">
            <div className="flex justify-end">
              <div className="max-w-sm rounded-2xl rounded-br-md bg-ink px-4 py-3 text-sm text-paper">
                Ich gehe in der Schule.
              </div>
            </div>
            <div className="rounded-2xl rounded-bl-md bg-paper px-4 py-3 text-sm text-ink-2 ring-1 ring-line">
              <span className="text-warn-ink line-through decoration-1">
                Ich gehe in der Schule.
              </span>{" "}
              →{" "}
              <span className="font-medium text-good-ink">
                Ich gehe in <strong>die</strong> Schule.
              </span>
              <p className="mt-1 text-[12px] text-mute">
                Direction, not location — Akkusativ.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            Your mastery this week
          </p>
          <div className="rounded-xl border border-line bg-paper p-4">
            <p className="text-[13px] font-medium text-ink">Akkusativ articles</p>
            <p className="mt-0.5 text-[11px] text-mute">A1 · 9 attempts · 62%</p>
            <div className="mt-3">
              <GrammarTable
                table={{
                  columns: ["Nom.", "Akk.", "Dat."],
                  rows: [
                    {
                      label: "m.",
                      cells: [
                        { value: "der" },
                        { value: "den", highlight: true },
                        { value: "dem" },
                      ],
                    },
                    {
                      label: "f.",
                      cells: [{ value: "die" }, { value: "die" }, { value: "der" }],
                    },
                    {
                      label: "n.",
                      cells: [{ value: "das" }, { value: "das" }, { value: "dem" }],
                    },
                  ],
                }}
                mode="full"
              />
            </div>
          </div>
          <MiniMasteryGrid />
        </div>
      </div>
    </section>
  );
}

function MiniMasteryGrid() {
  const cells: { label: string; level: 0 | 1 | 2 | 3 | 4 }[] = [
    { label: "SVO", level: 4 },
    { label: "Präsens", level: 4 },
    { label: "Modal", level: 3 },
    { label: "Akkusativ", level: 2 },
    { label: "Dativ", level: 2 },
    { label: "Reflexive", level: 1 },
    { label: "Komparat.", level: 1 },
    { label: "Imperativ", level: 0 },
  ];
  const TINT: Record<0 | 1 | 2 | 3 | 4, { bg: string; color: string; border: string }> = {
    0: { bg: "#fbfaf6", color: "#6b6b73", border: "#e7e6e1" },
    1: { bg: "#f3efe2", color: "#3d3d44", border: "#e7e6e1" },
    2: { bg: "#e6decd", color: "#3d3d44", border: "#dccfb6" },
    3: { bg: "#cbe0bd", color: "#16161a", border: "#b6d2a4" },
    4: { bg: "#7fae6a", color: "#fafaf8", border: "#7fae6a" },
  };
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            backgroundColor: TINT[c.level].bg,
            color: TINT[c.level].color,
            borderColor: TINT[c.level].border,
          }}
          className="aspect-square rounded-md border p-1.5"
        >
          <p className="text-[9px] font-semibold leading-tight">{c.label}</p>
          <p className="mt-1 font-mono text-[9px]">
            {c.level === 0 ? "—" : `${[0, 22, 54, 81, 96][c.level]}%`}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── The difference ──────────────────────────────────────────────

function Difference() {
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
        "No streaks. No leaderboards. No notifications shaming you for missing a day. Just a quiet read on what you can already do, and what to look at tomorrow.",
    },
  ];
  return (
    <section id="why" className="border-t border-line bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          The difference
        </p>
        <h2 className="mt-3 max-w-3xl font-serif text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[44px]">
          Most apps teach you vocabulary.{" "}
          <em className="italic">A tutor teaches you your mistakes.</em>
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          You don&apos;t need another flashcard deck. You need someone who notices
          that you keep mixing up <em className="italic">der</em> and{" "}
          <em className="italic">den</em>, knows why, and gives you the one drill
          that fixes it.
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
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

// ── How it works ────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section id="how" className="border-t border-line bg-paper-warm">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          How it works
        </p>
        <h2 className="mt-3 max-w-3xl font-serif text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[44px]">
          Four moves. That&apos;s the whole product.
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          Speak. Get caught. See why. Try again tomorrow with what you missed.
        </p>

        <div className="mt-12 space-y-6">
          <Step
            n="01"
            title="Speak. The tutor catches you."
            body="Real-time corrections in plain language. The coach quotes what you said, shows the fix, and explains the rule in one line — never a wall of red."
          >
            <div className="rounded-xl border border-line bg-paper px-4 py-3 text-[13px] leading-relaxed">
              <span className="text-warn-ink line-through decoration-1">
                Ich gehe in der Schule.
              </span>{" "}
              →{" "}
              <span className="font-medium text-good-ink">
                Ich gehe in <strong>die</strong> Schule.
              </span>
              <p className="mt-1 text-[12px] text-mute">
                Direction, not location — Akkusativ.
              </p>
            </div>
          </Step>

          <Step
            n="02"
            title="One mistake at a time."
            body="The coach picks the structure you keep slipping on and stays with it. Today's focus shows you the exact pattern, the count, and the fix — in one sentence."
          >
            <div className="rounded-xl border border-line bg-paper-warm p-4 text-[13px]">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-mute">
                Today&apos;s focus
              </p>
              <p className="mt-1 text-ink">
                <span className="text-warn-ink">Ich habe der Apfel</span> →{" "}
                <span className="text-good-ink font-medium">den Apfel</span>
              </p>
              <p className="mt-1 text-[12px] text-mute">
                You&apos;ve made this swap <strong>9 times</strong> in the last
                14 sentences.
              </p>
            </div>
          </Step>

          <Step
            n="03"
            title="Watch the map fill in."
            body="23 grammar structures across A1–C1. Each cell brightens as you demonstrate it correctly across sessions — not in a single quiz, not by tapping multiple choice."
          >
            <MiniMasteryGrid />
          </Step>

          <Step
            n="04"
            title="End with a story, not silence."
            body="Every session closes with three numbers and one sentence: what you did, what tightened, and what to focus on tomorrow."
          >
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Sentences", value: "14", delta: "+3" },
                { label: "Accuracy", value: "86%", delta: "+11%" },
                { label: "New for you", value: "2", delta: "WECHSEL." },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-line bg-paper p-3"
                >
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-mute">
                    {s.label}
                  </p>
                  <p className="mt-1 font-serif text-2xl font-medium text-ink">
                    {s.value}
                  </p>
                  <p className="font-mono text-[10px] text-good-ink">{s.delta}</p>
                </div>
              ))}
            </div>
          </Step>
        </div>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  body,
  children,
}: {
  n: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-2xl border border-line bg-paper p-6 md:grid-cols-[0.4fr_1.6fr] md:gap-8 md:p-8">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
          Step {n}
        </p>
        <h3 className="mt-2 font-serif text-xl font-medium tracking-[-0.01em] text-ink md:text-2xl">
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{body}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ── Pull quote ──────────────────────────────────────────────────

function PullQuote() {
  return (
    <section className="border-t border-line bg-ink py-16 text-paper">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <p className="font-serif text-[28px] leading-tight tracking-[-0.015em] md:text-[40px]">
          <em className="italic">Grammar isn&apos;t memorized. It&apos;s demonstrated.</em>
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-paper/60">
          The premise
        </p>
      </div>
    </section>
  );
}

// ── Compare ─────────────────────────────────────────────────────

function Compare() {
  const rows: { app: string; us: string }[] = [
    { app: "Drill vocabulary out of context", us: "Catch your mistakes as you speak" },
    { app: "Tap-to-translate, multiple choice", us: "Voice-first, real conversation" },
    { app: "Streaks, leaderboards, mascots", us: "Quiet progress · no shame mechanics" },
    { app: "Generic curriculum, same for everyone", us: "Adaptive to your specific weak spots" },
    { app: "\u201CYou\u2019re at level 14\u201D — of what?", us: "\u201CYou\u2019ve mastered 8 of 23 structures\u201D" },
    { app: "You forget within a week", us: "It sticks — because you produced it" },
  ];
  return (
    <section className="border-t border-line bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          What we&apos;re not
        </p>
        <h2 className="mt-3 max-w-3xl font-serif text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[44px]">
          You&apos;ve tried the apps. You know how it ends.
        </h2>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-ink-2">
          Streaks broken on day 31. A green owl in your notifications. 800 words
          you &ldquo;learned&rdquo; but can&apos;t actually use in a sentence.
        </p>

        <div className="mt-10 overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-2 bg-line-2">
            <div className="px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
              Most language apps
            </div>
            <div className="border-l border-line px-5 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
              GrammarFlow
            </div>
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className={`grid grid-cols-2 ${i > 0 ? "border-t border-line" : ""}`}
            >
              <div className="bg-paper-warm px-5 py-4 text-[14px] text-ink-2">
                {r.app}
              </div>
              <div className="border-l border-line bg-paper px-5 py-4 text-[14px] text-ink">
                {r.us}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Get started ────────────────────────────────────────────────

function GetStarted() {
  const levels: { id: string; label: string; sub: string }[] = [
    { id: "A1", label: "A1", sub: "Beginner" },
    { id: "A2", label: "A2", sub: "Element." },
    { id: "B1", label: "B1", sub: "Intermed." },
    { id: "B2", label: "B2", sub: "Upper Int." },
    { id: "C1", label: "C1", sub: "Advanced" },
  ];
  return (
    <section id="signup-anchor" className="border-t border-line bg-paper-warm">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
          Get started
        </p>
        <h2 className="mt-3 font-serif text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[44px]">
          Two minutes. Then you&apos;re speaking.
        </h2>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
          Pick your level on the next page, make an account, start with a
          three-sentence warm-up. No credit card. No streak countdown waiting
          to punish you.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {levels.map((lvl) => (
            <Link
              key={lvl.id}
              href={`/signup?level=${lvl.id}`}
              className="rounded-xl border border-line bg-paper px-4 py-3 text-left transition-colors hover:bg-line-2"
            >
              <p className="font-serif text-lg font-medium tracking-[-0.01em] text-ink">
                {lvl.label}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
                {lvl.sub}
              </p>
            </Link>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            Create account & start →
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-line bg-paper px-5 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
          >
            I already have an account
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Final CTA + scope ──────────────────────────────────────────

function FinalCTA() {
  return (
    <>
      <section id="languages" className="border-t border-line bg-bg">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mute">
            What&apos;s next
          </p>
          <h2 className="mt-3 max-w-3xl font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-ink md:text-[36px]">
            German first. One language, done right.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">
            We&apos;re starting with German because its grammar is precise
            enough to teach this way — cases, articles, word order, separable
            verbs. Other languages later, when we&apos;re sure we won&apos;t
            water down what works.
          </p>
        </div>
      </section>

      <section className="border-t border-line bg-paper-warm">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 className="font-serif text-[36px] font-medium leading-[1.1] tracking-[-0.02em] text-ink md:text-[48px]">
            Stop drilling. Start speaking.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
            Two minutes to start. The first session is free, the second one is
            too, and so is the next month.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              Start speaking — free
            </Link>
            <a
              href="#how"
              className="rounded-full border border-line bg-paper px-5 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-line-2"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
