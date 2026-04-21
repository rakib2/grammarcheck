import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { REALTIME_TOOLS } from "@/lib/realtimeTools";
import { buildRealtimeInstructions } from "@/lib/realtimeInstructions";
import { LearnerModel } from "@/types";
import { getUserFromRequest, getSupabaseAdmin } from "@/lib/supabaseServer";

// Claude analysis can sometimes take several seconds; give the route room
// so Vercel doesn't kill us at the default 10s on hobby.
// Honored on Pro (up to 60s), clamped down on hobby automatically.
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Per-user daily cap on realtime voice sessions. Realtime audio runs ~$1–2
 * per 5-minute session, so a runaway user could burn meaningful credit.
 *
 * Limits are per-tier and configurable via env vars — raise them without
 * redeploying by updating Vercel's environment variables.
 *   - admin: no cap (for you / trusted internal testers)
 *   - pro:   DAILY_SESSION_LIMIT_PRO  (default 100)
 *   - free:  DAILY_SESSION_LIMIT_FREE (default 10)
 *
 * To promote a user to admin:
 *   update profiles set tier='admin' where id='<their user id>';
 */
type Tier = "free" | "pro" | "admin";

function limitForTier(tier: Tier): number {
  if (tier === "admin") return Number.POSITIVE_INFINITY;
  if (tier === "pro") {
    return parseInt(process.env.DAILY_SESSION_LIMIT_PRO ?? "100", 10);
  }
  return parseInt(process.env.DAILY_SESSION_LIMIT_FREE ?? "10", 10);
}

/**
 * POST /api/realtime/session
 *
 * Creates an ephemeral token for a WebRTC Realtime session.
 * The token is short-lived and safe to send to the browser.
 *
 * Auth:
 *  - Client forwards Supabase access token via `Authorization: Bearer <token>`.
 *  - If present and valid: enforces per-user daily session cap.
 *  - If absent: bypasses enforcement (local dev convenience — production
 *    traffic should always be authenticated because AuthGuard blocks the UI).
 *
 * Input: { learnerModel: LearnerModel }
 * Output: { token: string, expiresAt: number } | 429 when over cap
 */
export async function POST(request: NextRequest) {
  try {
    // ── Optional auth + tier-based rate-limit enforcement ──
    const user = await getUserFromRequest(request);
    if (user) {
      const admin = getSupabaseAdmin();
      if (admin) {
        // Resolve the caller's tier (falls back to 'free' if profile row
        // is missing — defensive against edge cases where signup didn't
        // create the profile).
        const { data: profile } = await admin
          .from("profiles")
          .select("tier")
          .eq("id", user.id)
          .maybeSingle();
        const tier = ((profile?.tier as Tier | undefined) ?? "free") as Tier;
        const limit = limitForTier(tier);

        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
        const { data: existing, error: readErr } = await admin
          .from("user_usage")
          .select("realtime_sessions_started")
          .eq("user_id", user.id)
          .eq("usage_date", today)
          .maybeSingle();

        if (readErr) {
          console.warn("[session] usage read failed, allowing request:", readErr.message);
        } else {
          const count = existing?.realtime_sessions_started ?? 0;
          if (Number.isFinite(limit) && count >= limit) {
            return NextResponse.json(
              {
                error: "daily_limit_reached",
                message:
                  `You've started ${count} voice sessions today — the daily limit for ${tier} accounts is ${limit}. ` +
                  `Resets at UTC midnight.`,
                tier,
                limit,
              },
              { status: 429 }
            );
          }

          // Atomic-ish increment via upsert. Two concurrent requests could both
          // read the same count and both increment, letting one user exceed the
          // cap by a small N — acceptable for a demo brake. Admin still gets
          // tracked for observability even though their limit is unbounded.
          const { error: upsertErr } = await admin
            .from("user_usage")
            .upsert(
              {
                user_id: user.id,
                usage_date: today,
                realtime_sessions_started: count + 1,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,usage_date" }
            );
          if (upsertErr) {
            console.warn("[session] usage upsert failed:", upsertErr.message);
          }
        }
      }
    }

    // ── Create ephemeral Realtime token ──
    const { learnerModel } = (await request.json()) as {
      learnerModel: LearnerModel;
    };

    const coachLanguage =
      learnerModel?.coachLanguage ??
      learnerModel?.nativeLanguage ??
      "English";
    const level = learnerModel?.detectedLevel ?? "A1";
    const nativeLanguage = learnerModel?.nativeLanguage ?? "English";

    const instructions = buildRealtimeInstructions({
      nativeLanguage,
      coachLanguage,
      level,
    });

    const session = await openai.beta.realtime.sessions.create({
      model: "gpt-4o-realtime-preview-2025-06-03",
      modalities: ["text", "audio"],
      voice: "coral",
      instructions,
      input_audio_transcription: {
        model: "gpt-4o-transcribe",
        language: "de",
        prompt: "German language practice conversation with a learner",
      },
      turn_detection: {
        type: "semantic_vad",
        eagerness: "low", // learners need time to think
        interrupt_response: true,
        create_response: true,
      },
      input_audio_noise_reduction: { type: "near_field" },
      temperature: 0.8,
      tools: REALTIME_TOOLS,
      tool_choice: "auto",
    });

    return NextResponse.json({
      token: session.client_secret?.value,
      expiresAt: session.client_secret?.expires_at,
    });
  } catch (error) {
    console.error("Realtime session error:", error);
    return NextResponse.json(
      { error: "Failed to create realtime session" },
      { status: 500 }
    );
  }
}
