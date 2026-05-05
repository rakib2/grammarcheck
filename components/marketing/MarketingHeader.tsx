"use client";

import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import { useAuth } from "@/lib/AuthContext";

/**
 * Marketing-page header. Auth-aware:
 *  - Signed out: shows "Log in" + "Start free"
 *  - Signed in:  shows the user's email + "Continue practicing →"
 *
 * Brand mark always points to `/`; the home page itself bounces signed-in
 * visitors to `/practice` (see RedirectIfAuthed), so an authed user
 * clicking the brand still lands in the right place.
 */

interface MarketingHeaderProps {
  activePath?: string;
}

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/#how", label: "How it works" },
  { href: "/#why", label: "Why a tutor" },
  { href: "/about", label: "About" },
];

export default function MarketingHeader({ activePath }: MarketingHeaderProps) {
  const { user, loading } = useAuth();
  const showAuthed = !loading && !!user;

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2">
          <BrandMark size={24} />
          <span className="font-serif text-lg font-medium tracking-[-0.01em] text-ink">
            GrammarFlow
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-[13px] text-ink-2 md:flex">
          {NAV_ITEMS.map((item) => {
            const isActive = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive
                    ? "text-ink transition-colors"
                    : "transition-colors hover:text-ink"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {showAuthed ? (
            <>
              <span className="hidden truncate text-[12px] text-mute md:inline">
                {user?.email}
              </span>
              <Link
                href="/practice"
                className="rounded-full bg-ink px-4 py-1.5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
              >
                Continue practicing →
              </Link>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </header>
  );
}
