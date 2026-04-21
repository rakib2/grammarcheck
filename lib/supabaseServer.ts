import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client built with the SERVICE ROLE key.
 * Bypasses RLS — use ONLY in API routes, NEVER import into client components.
 *
 * If SUPABASE_SERVICE_ROLE_KEY is not set (e.g. local dev without that secret),
 * callers should gracefully degrade (e.g. skip usage enforcement) rather than
 * crash.
 */
let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  _adminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}

/**
 * Resolve the currently signed-in user from an incoming request.
 * Expects the client to forward their Supabase access token via
 * `Authorization: Bearer <token>`.
 *
 * Returns null when:
 *  - no Authorization header (e.g. localhost bypass)
 *  - token is invalid/expired
 *  - Supabase env is not configured
 */
export async function getUserFromRequest(
  req: Request
): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
