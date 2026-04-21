import { NextRequest } from "next/server";
import OpenAI, { toFile } from "openai";
import { streamAnalyzeForConversation, LearnerContext } from "@/lib/anthropic";
import {
  processUserTurn,
  createLearnerModel,
  createConversationState,
} from "@/lib/conversationEngine";
import { LearnerModel, ConversationState } from "@/types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * POST /api/voice/pipeline
 *
 * Unified voice pipeline: Audio in → Transcript → Claude analysis → Sentence-level TTS → Audio out
 *
 * Input: FormData with:
 *   - audio: Blob (webm/opus from MediaRecorder)
 *   - learnerModel: JSON string
 *   - conversationState: JSON string
 *   - persistentErrors?: JSON string (string[])
 *   - sessionFocus?: JSON string (string[])
 *
 * Output: NDJSON stream of events:
 *   {"type":"transcript","text":"..."}              — what the user said (from Whisper)
 *   {"type":"token","text":"..."}                   — coach message streaming token
 *   {"type":"audio","data":"base64...","idx":0}     — TTS audio chunk for a sentence
 *   {"type":"coachDone","text":"..."}               — full coach message text
 *   {"type":"analysis","data":{...}}                — full engine output
 *   {"type":"error","message":"..."}                — error
 *
 * Privacy:
 *   - Whisper only sees raw audio (no user context)
 *   - TTS only sees coach response text (no user data)
 *   - Claude sees transcript + teaching context (same as existing /api/converse)
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  function encode(event: Record<string, unknown>): Uint8Array {
    return encoder.encode(JSON.stringify(event) + "\n");
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // ── 1. Parse FormData ──
        const formData = await request.formData();
        const audioBlob = formData.get("audio") as Blob | null;
        const learnerModelStr = formData.get("learnerModel") as string | null;
        const convStateStr = formData.get("conversationState") as string | null;
        const persistentErrorsStr = formData.get("persistentErrors") as string | null;
        const sessionFocusStr = formData.get("sessionFocus") as string | null;

        if (!audioBlob || !learnerModelStr || !convStateStr) {
          controller.enqueue(encode({ type: "error", message: "Missing required fields: audio, learnerModel, conversationState" }));
          controller.close();
          return;
        }

        const learnerModel: LearnerModel = JSON.parse(learnerModelStr);
        const conversationState: ConversationState = JSON.parse(convStateStr);
        const persistentErrors: string[] = persistentErrorsStr ? JSON.parse(persistentErrorsStr) : [];
        const sessionFocus: string[] = sessionFocusStr ? JSON.parse(sessionFocusStr) : [];

        // ── 2. Whisper STT (only raw audio sent — no user context) ──
        const audioFile = await toFile(audioBlob, "audio.webm", {
          type: audioBlob.type || "audio/webm",
        });

        const transcription = await openai.audio.transcriptions.create({
          model: "whisper-1",
          file: audioFile,
          language: "de",
          prompt: "German language practice conversation",
        });

        const sentence = transcription.text.trim();
        if (!sentence) {
          controller.enqueue(encode({ type: "error", message: "No speech detected" }));
          controller.close();
          return;
        }

        // Send transcript immediately so client can show it
        controller.enqueue(encode({ type: "transcript", text: sentence }));

        // ── 3. Claude streaming analysis (reuses existing engine) ──
        const recentTurns = conversationState.turns.slice(-6);
        const contextStr = recentTurns
          .map((t) => `${t.role === "user" ? "User" : "Coach"}: ${t.text}`)
          .join("\n");

        const improving = learnerModel.structures
          .filter((s) => s.lastCorrect && s.mastery > 0.3)
          .map((s) => s.name);
        const struggling = learnerModel.structures
          .filter((s) => s.mastery < 0.4 && s.attempts > 0)
          .map((s) => s.name);
        const recentErrors = learnerModel.errorPatterns
          .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
          .slice(0, 3)
          .map((e) => `${e.example} → ${e.correction}`);

        let focusDrilling: string | undefined;
        if (conversationState.focusStructure && conversationState.focusRemaining > 0) {
          const { getStructureById } = await import("@/lib/grammarStructures");
          const focusDef = getStructureById(conversationState.focusStructure);
          focusDrilling = focusDef?.name ?? conversationState.focusStructure;
        }

        const learnerContext: LearnerContext = {
          nativeLanguage: learnerModel.nativeLanguage,
          coachLanguage: learnerModel.coachLanguage ?? learnerModel.nativeLanguage,
          sessionCount: learnerModel.sessionCount,
          totalTurns: learnerModel.totalTurns,
          detectedLevel: learnerModel.detectedLevel,
          improving,
          struggling,
          recentErrors,
          focusDrilling,
          persistentErrors: persistentErrors.length > 0 ? persistentErrors : undefined,
          sessionFocus: sessionFocus.length > 0 ? sessionFocus : undefined,
        };

        const gen = streamAnalyzeForConversation(
          sentence,
          learnerModel.nativeLanguage,
          conversationState.currentTarget,
          contextStr,
          learnerContext
        );

        // ── 4. Stream tokens + collect sentences for TTS ──
        // We accumulate the coach message and fire off TTS for each complete sentence
        let fullCoachText = "";
        let ttsBuffer = "";     // accumulates text until sentence boundary
        let sentenceIdx = 0;
        const ttsQueue: Promise<void>[] = [];

        // Fire TTS for a sentence and stream the audio chunk back
        const flushSentenceTTS = async (text: string, idx: number) => {
          try {
            const clean = text
              .replace(/\*\*(.*?)\*\*/g, "$1")
              .replace(/\n/g, ". ")
              .replace(/\s+/g, " ")
              .trim();
            if (!clean) return;

            const ttsResponse = await openai.audio.speech.create({
              model: "tts-1",
              voice: "nova",
              input: clean,
              response_format: "mp3",
              speed: 0.95,
            });

            const buffer = Buffer.from(await ttsResponse.arrayBuffer());
            const base64 = buffer.toString("base64");
            controller.enqueue(encode({ type: "audio", data: base64, idx }));
          } catch (err) {
            console.error(`TTS error for sentence ${idx}:`, err);
            // Non-fatal: client will still have text, just no audio for this chunk
          }
        };

        // Check for sentence boundaries and kick off TTS
        const checkSentenceBoundary = () => {
          // Match sentence-ending punctuation followed by space or end-of-string
          const match = ttsBuffer.match(/[.!?]+[\s]|[.!?]+$/);
          if (match && match.index !== undefined) {
            const endPos = match.index + match[0].length;
            const completeSentence = ttsBuffer.slice(0, endPos).trim();
            ttsBuffer = ttsBuffer.slice(endPos);

            if (completeSentence.length > 5) {
              // Fire TTS immediately (don't await — runs in parallel)
              const idx = sentenceIdx++;
              ttsQueue.push(flushSentenceTTS(completeSentence, idx));
            } else {
              // Very short fragment — append to next sentence
              ttsBuffer = completeSentence + " " + ttsBuffer;
            }
          }
        };

        for await (const event of gen) {
          if (event.type === "token") {
            controller.enqueue(encode({ type: "token", text: event.text }));
            ttsBuffer += event.text;
            checkSentenceBoundary();
          } else if (event.type === "coachDone") {
            fullCoachText = event.text;
            controller.enqueue(encode({ type: "coachDone", text: event.text }));

            // Flush any remaining text in the TTS buffer
            const remaining = ttsBuffer.trim();
            if (remaining && remaining.length > 5) {
              const idx = sentenceIdx++;
              ttsQueue.push(flushSentenceTTS(remaining, idx));
            }
            ttsBuffer = "";
          } else if (event.type === "analysis") {
            // Run the conversation engine
            const output = processUserTurn({
              userSentence: sentence,
              learnerModel,
              conversationState,
              analysisFromAPI: event.data,
            });

            controller.enqueue(encode({
              type: "analysis",
              data: {
                responseText: output.responseText,
                corrections: output.corrections,
                ruleCard: output.ruleCard,
                nextPrompt: output.nextPrompt,
                score: output.score,
                detectedLevel: output.detectedLevel,
                tokens: output.tokens,
                updatedModel: output.updatedModel,
                updatedState: output.updatedState,
                lessonSuggestion: output.lessonSuggestion,
                activeRule: output.activeRule,
                deepPracticeNudge: output.deepPracticeNudge,
              },
            }));

            // Also generate TTS for the nextPrompt
            if (output.nextPrompt) {
              const idx = sentenceIdx++;
              ttsQueue.push(flushSentenceTTS(output.nextPrompt, idx));
            }
          }
        }

        // Wait for all TTS requests to complete before closing
        await Promise.all(ttsQueue);

        // Signal that all audio chunks have been sent
        controller.enqueue(encode({ type: "done", totalAudioChunks: sentenceIdx }));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("Voice pipeline error:", errMsg);
        controller.enqueue(encode({ type: "error", message: errMsg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
    },
  });
}
