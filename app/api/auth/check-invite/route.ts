import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/check-invite
 *
 * Validates the invite code before letting a user proceed to Supabase signup.
 * Gate is enforced by comparing against SIGNUP_INVITE_CODE env var.
 *
 * If SIGNUP_INVITE_CODE is unset/empty, the gate is disabled (open signup) —
 * this is explicit so local dev is friction-free, but production must set it.
 *
 * Input:  { code: string }
 * Output: { ok: true } | { ok: false, reason: string } (HTTP 403 on invalid)
 */
export async function POST(request: NextRequest) {
  try {
    const expected = process.env.SIGNUP_INVITE_CODE?.trim();

    // Gate disabled — open signup. Fine for local/dev, explicit-opt-in for prod.
    if (!expected) {
      return NextResponse.json({ ok: true });
    }

    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    const submitted = body?.code?.trim() ?? "";

    // Constant-time-ish comparison (length match first, then char-by-char)
    // Not meant to resist sophisticated timing attacks — this is a demo gate.
    if (submitted.length !== expected.length) {
      return NextResponse.json({ ok: false, reason: "Invalid invite code" }, { status: 403 });
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= submitted.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch !== 0) {
      return NextResponse.json({ ok: false, reason: "Invalid invite code" }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid request" }, { status: 400 });
  }
}
