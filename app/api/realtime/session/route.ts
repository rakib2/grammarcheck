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
 * 10 sessions/day is comfortable for a genuine learner and a hard brake on
 * abuse.
 */
const DAILY_SESSION_LIMIT = 10;

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
    // ── Optional auth + rate-limit enforcement ──
    const user = await getUserFromRequest(request);
    if (user) {
      const admin = getSupabaseAdmin();
      if (admin) {
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
          if (count >= DAILY_SESSION_LIMIT) {
            return NextResponse.json(
              {
                error: "daily_limit_reached",
                message: `You've started ${count} voice sessions today. Try again tomorrow — this limit keeps costs sane while we're in demo.`,
              },
              { status: 429 }
            );
          }

          // Atomic-ish increment via upsert. Two concurrent requests could both
          // read the same count and both increment, letting one user exceed the
          // cap by a small N — acceptable for a demo brake.
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
