import type { Metadata } from "next";
import LandingPage from "@/components/marketing/LandingPage";
import RedirectIfAuthed from "@/components/RedirectIfAuthed";

/**
 * Apex (`/`) — the public landing.
 *
 * Server-rendered for unauthenticated visitors (good for SEO and for
 * corporate web filters that classify by crawled content). Authenticated
 * visitors are bounced to `/practice` by the small client island below.
 */

export const metadata: Metadata = {
  title: "GrammarFlow — A tutor for your German grammar",
  description:
    "Voice-first German grammar coach. Catches the structures you keep getting wrong, walks you through them, tracks what you've actually mastered. No streaks, no shame.",
};

export default function HomePage() {
  return (
    <>
      <RedirectIfAuthed to="/practice" />
      <LandingPage />
    </>
  );
}
