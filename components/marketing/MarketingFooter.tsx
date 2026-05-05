import Link from "next/link";
import BrandMark from "@/components/BrandMark";

/**
 * Shared footer for public marketing pages (`/`, `/about`).
 * Server component — no auth dependence.
 */
export default function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-bg">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2">
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
            { href: "/#how", label: "How it works" },
            { href: "/#why", label: "Why a tutor" },
            { href: "/#languages", label: "Languages" },
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
          <p>Düsseldorf</p>
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
