/**
 * Hot-tier chat persistence — stores the visible conversation scrollback in
 * localStorage so a refresh doesn't blow away the user's in-flight session.
 *
 * Path A of the persistence plan: lightweight, single-device, short TTL.
 * Long-term durability lives in the learner model + session summaries
 * already saved to Supabase — those carry the *brain* across sessions.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const KEY_PREFIX = "gf:chatSession:";
const ANON_KEY = "anon";

type CachedSession<TTurn, TConvState> = {
  turns: TTurn[];
  convState: TConvState | null;
  savedAt: number;
  schemaVersion: 1;
};

function storageKey(userId: string | null): string {
  return KEY_PREFIX + (userId ?? ANON_KEY);
}

export function loadCachedSession<TTurn, TConvState>(
  userId: string | null
): CachedSession<TTurn, TConvState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSession<TTurn, TConvState>;
    if (parsed.schemaVersion !== 1) return null;
    if (!Array.isArray(parsed.turns)) return null;
    if (Date.now() - parsed.savedAt > TTL_MS) {
      window.localStorage.removeItem(storageKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedSession<TTurn, TConvState>(
  userId: string | null,
  turns: TTurn[],
  convState: TConvState | null
): void {
  if (typeof window === "undefined") return;
  if (turns.length === 0) {
    window.localStorage.removeItem(storageKey(userId));
    return;
  }
  try {
    const payload: CachedSession<TTurn, TConvState> = {
      turns,
      convState,
      savedAt: Date.now(),
      schemaVersion: 1,
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    // Quota exceeded or serialization failed — drop silently. The learner
    // model and summaries are already in Supabase, so the brain survives.
  }
}

export function clearCachedSession(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {}
}
