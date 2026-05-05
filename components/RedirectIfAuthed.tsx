"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

/**
 * Tiny client island that redirects authenticated visitors elsewhere.
 *
 * Used on the public landing at `/` so signed-in users land directly in
 * the practice surface instead of seeing marketing copy. The page itself
 * still server-renders the landing — good for SEO and signed-out users —
 * and this component only fires the redirect after auth state resolves.
 */
export default function RedirectIfAuthed({ to }: { to: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(to);
    }
  }, [user, loading, to, router]);

  return null;
}
