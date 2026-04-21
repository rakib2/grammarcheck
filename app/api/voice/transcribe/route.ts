import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * POST /api/voice/transcribe
 *
 * Receives audio blob (webm/opus from MediaRecorder), transcribes via Whisper.
 * Returns: { text: string }
 *
 * Privacy: only raw audio is sent to OpenAI — no user context, no learner model.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get("audio") as Blob | null;

    if (!audioBlob) {
      return NextResponse.json(
        { error: "Missing audio blob" },
        { status: 400 }
      );
    }

    // Convert Blob to a File-like object for the OpenAI SDK
    const audioFile = await toFile(audioBlob, "audio.webm", {
      type: audioBlob.type || "audio/webm",
    });

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
      language: "de", // German — improves accuracy significantly
      prompt: "German language practice conversation", // helps Whisper context
    });

    return NextResponse.json({ text: transcription.text });
  } catch (error) {
    console.error("Whisper transcription error:", error);
    return NextResponse.json(
      { error: "Transcription failed" },
      { status: 500 }
    );
  }
}
