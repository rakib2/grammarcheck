import { redirect } from "next/navigation";

/**
 * Legacy redirect: the landing has moved to the apex (`/`).
 * Kept so any old bookmarks or external links to /landing don't 404.
 */
export default function LandingRedirect() {
  redirect("/");
}
