"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { migrateLearnerModelToSupabase, needsMigration } from "@/lib/migrateLearnerModel";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
});

function isLocalDev(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Run localStorage → Supabase migration after login
  const runMigrationIfNeeded = useCallback(async (userId: string) => {
    if (needsMigration()) {
      const result = await migrateLearnerModelToSupabase(supabase, userId);
      if (result.status === "success") {
        console.log("[auth] Migrated localStorage data to Supabase:", result.counts);
      } else if (result.status === "error") {
        console.warn("[auth] Migration failed (will retry next login):", result.reason);
      }
    }
  }, []);

  useEffect(() => {
    // Skip auth on localhost — just mark as not loading
    if (isLocalDev()) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user) {
        runMigrationIfNeeded(s.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
        if (s?.user) {
          runMigrationIfNeeded(s.user.id);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [runMigrationIfNeeded]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };

    // Create profile row for the new user
    if (data.user) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .insert({ id: data.user.id });
      if (profileErr && !profileErr.message.includes("duplicate")) {
        console.warn("[auth] Failed to create profile:", profileErr.message);
      }
    }

    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
