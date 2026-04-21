"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

/**
 * Wrap any page that requires authentication.
 * Bypassed on localhost for local development.
 *
 * Renders children on first pass to avoid hydration mismatch,
 * then checks auth after mount.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || loading) return;
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal && !user) {
      router.replace("/login");
    }
  }, [user, loading, router, mounted]);

  // Before mount: render children to match server HTML (no hydration mismatch)
  if (!mounted) return <>{children}</>;

  // After mount: localhost skips auth entirely
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return <>{children}</>;

  // Production: show loading while checking auth
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
