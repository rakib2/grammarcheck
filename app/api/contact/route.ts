import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

/**
 * POST /api/contact
 *
 * Receives messages from the public contact form on /about and forwards
 * them to CONTACT_EMAIL via Resend. The recipient address is never
 * exposed in the browser.
 *
 * Required env vars:
 *   RESEND_API_KEY  — from resend.com (free: 3,000 emails/month)
 *   CONTACT_EMAIL   — destination inbox (e.g. your gmail)
 *
 * Optional:
 *   CONTACT_FROM    — sender address (default: onboarding@resend.dev)
 */

interface ContactBody {
  name?: unknown;
  email?: unknown;
  message?: unknown;
  website?: unknown;
}

export async function POST(req: NextRequest) {
  let body: ContactBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, message, website } = body;

  if (typeof website === "string" && website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (typeof email !== "string" || typeof message !== "string") {
    return NextResponse.json({ error: "email and message are required" }, { status: 400 });
  }

  const trimmedEmail = email.trim();
  const trimmedMessage = message.trim();
  const trimmedName = typeof name === "string" ? name.trim() : "";

  if (!trimmedEmail || !trimmedMessage) {
    return NextResponse.json({ error: "email and message cannot be empty" }, { status: 400 });
  }

  if (trimmedEmail.length > 200 || trimmedMessage.length > 5000 || trimmedName.length > 100) {
    return NextResponse.json({ error: "Input too long" }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.CONTACT_EMAIL;
  const fromAddress = process.env.CONTACT_FROM || "GrammarFlow <onboarding@resend.dev>";

  if (!apiKey || !recipient) {
    console.error("[contact] Missing RESEND_API_KEY or CONTACT_EMAIL env var");
    return NextResponse.json({ error: "Contact form is not configured" }, { status: 500 });
  }

  const resend = new Resend(apiKey);

  const subjectLabel = trimmedName ? `${trimmedName} <${trimmedEmail}>` : trimmedEmail;
  const textBody = [
    `From: ${trimmedName || "(no name)"} <${trimmedEmail}>`,
    "",
    trimmedMessage,
  ].join("\n");

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: recipient,
      replyTo: trimmedEmail,
      subject: `[GrammarFlow] Message from ${subjectLabel}`,
      text: textBody,
    });

    if (result.error) {
      console.error("[contact] Resend returned error:", result.error);
      return NextResponse.json({ error: "Failed to send message" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[contact] Send threw:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 502 });
  }
}
