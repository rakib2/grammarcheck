import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Voice = "nova" | "shimmer" | "alloy" | "echo" | "fable" | "onyx";

/**
 * POST /api/tts
 *
 * Converts text to speech using OpenAI TTS.
 * Returns audio as an MP3 stream for instant playback.
 */
export async function POST(request: NextRequest) {
  try {
    const { text, voice = "nova" } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    // Strip markdown before sending to TTS
    const clean = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\n/g, ". ")
      .replace(/\s+/g, " ")
      .trim();

    // Limit to 4096 chars (OpenAI max)
    const truncated = clean.slice(0, 4096);

    const response = await openai.audio.speech.create({
      model: "tts-1",           // fast model, good enough for conversation
      voice: voice as Voice,
      input: truncated,
      response_format: "mp3",
      speed: 0.95,              // slightly slower for language learning clarity
    });

    // Stream the audio back
    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=86400", // cache same text for 24h
      },
    });
  } catch (error) {
    console.error("TTS error:", error);
    return NextResponse.json(
      { error: "TTS generation failed" },
      { status: 500 }
    );
  }
}
