import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { REALTIME_TOOLS } from "@/lib/realtimeTools";
import { LearnerModel } from "@/types";
import { getUserFromRequest, getSupabaseAdmin } from "@/lib/supabaseServer";

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

    const coachLang =
      learnerModel?.coachLanguage ??
      learnerModel?.nativeLanguage ??
      "English";
    const level = learnerModel?.detectedLevel ?? "A1";
    const nativeLang = learnerModel?.nativeLanguage ?? "English";

    const instructions = `You are the voice of GrammarCoach — a warm, skilled German language tutor having a real-time spoken conversation with a learner.

The learner's native language is ${nativeLang}. Their current level is roughly ${level}. Respond in ${coachLang} unless they ask to switch.

YOUR ROLE:
- Be a warm, encouraging conversation partner — like a friend who happens to be great at German
- ALWAYS call the analyze_german_sentence tool when the learner says something in German
- Base your spoken response on the coachMessage from the tool result — do NOT invent grammar corrections
- Add natural warmth around the tool's corrections

AT THE START:
- Call get_session_context to learn about the student and get your opening message
- Speak the opener naturally

SPEECH STYLE:
- Speak naturally — this is a conversation, not a lecture
- Keep each reply SHORT — 1–2 sentences. Let the learner breathe.
- When correcting, say the correct form clearly: "It's 'mit meinem Freund' — after 'mit' we use Dativ"
- Celebrate when they get something right that they struggled with before
- Match your language complexity to their level (${level})

CRITICAL — PACING:
- After you deliver a correction or feedback, STOP SPEAKING. Do NOT chain a follow-up question onto the same reply.
- Do NOT read the tool's nextPrompt aloud — it is shown to the learner visually so they can read and choose when to continue.
- The learner needs silent time to read the correction card, scroll back, and absorb. Give it to them.
- Wait in silence for the learner to speak next. They will speak when they're ready.
- If the learner asks you a direct question, answer briefly and then stop again.`;

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
