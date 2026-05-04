"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LearnerModel, ConversationState } from "@/types";
import { VoiceTurnAnalysis } from "./realtimeTools";
import { supabase } from "./supabase";

// ── Types ──

export type RealtimeState =
  | "idle"        // not connected
  | "connecting"  // fetching token + setting up WebRTC
  | "listening"   // connected, waiting for user to speak
  | "thinking"    // model is processing (tool call in flight)
  | "speaking";   // model is speaking

interface ToolCallAccumulator {
  callId: string;
  name: string;
  arguments: string;
}

interface SpeechWindow {
  startedAt: number;
  stoppedAt: number | null;
  overlappedAssistant: boolean;
}

type TranscriptDecision =
  | { accepted: true }
  | { accepted: false; reason: string };

export interface RealtimeCallbacks {
  /** User's speech transcribed */
  onUserTranscript?: (text: string, isFinal: boolean) => void;
  /** Candidate transcript rejected before analysis/model update */
  onTranscriptRejected?: (text: string, reason: string) => void;
  /** Model's response text (for display) */
  onModelText?: (text: string) => void;
  /** Learner model updated from tool result */
  onModelUpdate?: (model: LearnerModel, state: ConversationState) => void;
  /** Full per-turn analysis from analyze_german_sentence — render this like Quick Practice */
  onTurnAnalysis?: (analysis: VoiceTurnAnalysis) => void;
  /** Error */
  onError?: (message: string) => void;
  /** State changed */
  onStateChange?: (state: RealtimeState) => void;
}

interface UseRealtimeVoiceOptions {
  learnerModel: LearnerModel | null;
  conversationState: ConversationState | null;
  /** Structure IDs the learner has dismissed a handoff CTA for in this session.
   *  Forwarded to the tool so the voice model stops re-offering the lesson. */
  dismissedNudges?: string[];
  callbacks: RealtimeCallbacks;
}

interface UseRealtimeVoiceReturn {
  state: RealtimeState;
  connect: () => Promise<void>;
  disconnect: () => void;
  isSupported: boolean;
  /** Push a raw event to the Realtime DataChannel — used for mid-session steering
   *  (session.update instructions, conversation.item.create system notes, etc). */
  sendEvent: (event: Record<string, unknown>) => void;
  /** Pre-fetch an ephemeral token so the next connect() skips the token roundtrip.
   *  Tokens are short-lived; we cache for 50s. Safe to call repeatedly. */
  prefetchToken: () => Promise<void>;
}

const TOKEN_FRESHNESS_MS = 50 * 1000;
const IDLE_TIMEOUT_MS = 30 * 1000;
const MIN_SPEECH_MS = 450;
const ASSISTANT_ECHO_SUPPRESSION_MS = 900;

function normalizeForVoiceGuard(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^0-9a-zäöüß\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapRatio(a: string, b: string): number {
  const left = normalizeForVoiceGuard(a).split(" ").filter(Boolean);
  const right = new Set(normalizeForVoiceGuard(b).split(" ").filter(Boolean));
  if (left.length === 0 || right.size === 0) return 0;
  const overlap = left.filter((token) => right.has(token)).length;
  return overlap / left.length;
}

// ── Hook ──

export function useRealtimeVoice(
  options: UseRealtimeVoiceOptions
): UseRealtimeVoiceReturn {
  const { learnerModel, conversationState, dismissedNudges, callbacks } = options;

  const [state, setState] = useState<RealtimeState>("idle");
  const stateRef = useRef<RealtimeState>("idle");
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const learnerModelRef = useRef(learnerModel);
  learnerModelRef.current = learnerModel;
  const convStateRef = useRef(conversationState);
  convStateRef.current = conversationState;
  const dismissedNudgesRef = useRef<string[]>(dismissedNudges ?? []);
  dismissedNudgesRef.current = dismissedNudges ?? [];

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const toolCallsRef = useRef<Map<string, ToolCallAccumulator>>(new Map());
  const prefetchedTokenRef = useRef<{ token: string; fetchedAt: number } | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micReenableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSpeechRef = useRef<SpeechWindow | null>(null);
  const lastCompletedSpeechRef = useRef<SpeechWindow | null>(null);
  const assistantSpeakingRef = useRef(false);
  const assistantSuppressUntilRef = useRef(0);
  const currentAssistantTextRef = useRef("");
  const recentAssistantTextsRef = useRef<string[]>([]);
  const debugVoiceRef = useRef(false);

  const [isSupported] = useState(
    typeof window !== "undefined" &&
      typeof RTCPeerConnection !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
  );

  useEffect(() => {
    debugVoiceRef.current =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("voiceDebug") === "1";
  }, []);

  function debugVoice(event: string, details: Record<string, unknown> = {}) {
    if (!debugVoiceRef.current) return;
    console.debug(`[voice:${event}]`, details);
  }

  function updateState(s: RealtimeState) {
    stateRef.current = s;
    setState(s);
    if (s !== "idle") {
      lastActivityRef.current = Date.now();
    }
    // Gate the microphone only while tutor audio is playing. Otherwise speaker
    // audio can leak back into the mic and get interpreted as learner speech.
    // Re-enable on audio/response completion, with a short fail-safe in case a
    // browser misses the final event.
    const stream = streamRef.current;
    if (stream) {
      const enabled = s !== "speaking";
      stream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      if (micReenableTimerRef.current) {
        clearTimeout(micReenableTimerRef.current);
        micReenableTimerRef.current = null;
      }
      if (!enabled) {
        micReenableTimerRef.current = setTimeout(() => {
          streamRef.current?.getAudioTracks().forEach((track) => {
            track.enabled = true;
          });
        }, 12_000);
      }
    }
    callbacksRef.current.onStateChange?.(s);
  }

  function bumpActivity() {
    lastActivityRef.current = Date.now();
  }

  function finishAssistantAudio() {
    if (currentAssistantTextRef.current.trim()) {
      recentAssistantTextsRef.current = [
        currentAssistantTextRef.current,
        ...recentAssistantTextsRef.current,
      ].slice(0, 4);
      currentAssistantTextRef.current = "";
    }
    assistantSpeakingRef.current = false;
    assistantSuppressUntilRef.current = Date.now() + ASSISTANT_ECHO_SUPPRESSION_MS;
  }

  function decideTranscript(sentence: string): TranscriptDecision {
    const normalized = normalizeForVoiceGuard(sentence);
    if (!normalized) {
      return { accepted: false, reason: "empty_transcript" };
    }

    const speech = lastCompletedSpeechRef.current ?? currentSpeechRef.current;
    if (!speech) {
      return { accepted: false, reason: "no_speech_started_event" };
    }

    const stoppedAt = speech.stoppedAt ?? Date.now();
    const duration = stoppedAt - speech.startedAt;
    if (duration < MIN_SPEECH_MS) {
      return { accepted: false, reason: `speech_too_short_${duration}ms` };
    }

    if (speech.overlappedAssistant || speech.startedAt < assistantSuppressUntilRef.current) {
      return { accepted: false, reason: "assistant_audio_overlap" };
    }

    const now = Date.now();
    if (now < assistantSuppressUntilRef.current) {
      return { accepted: false, reason: "assistant_audio_cooldown" };
    }

    for (const assistantText of recentAssistantTextsRef.current) {
      const overlap = tokenOverlapRatio(sentence, assistantText);
      if (overlap >= 0.72) {
        return { accepted: false, reason: `echo_text_overlap_${Math.round(overlap * 100)}pct` };
      }
    }

    return { accepted: true };
  }

  // ── Send event to Realtime API via DataChannel ──

  function sendEvent(event: Record<string, unknown>) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(event));
    }
  }

  // ── Handle tool call: POST to our server, send result back ──

  async function handleToolCall(callId: string, name: string, args: string) {
    updateState("thinking");

    try {
      const parsedArgs = JSON.parse(args);
      if (name === "analyze_german_sentence") {
        const sentence = String(parsedArgs.sentence ?? "");
        const decision = decideTranscript(sentence);
        currentSpeechRef.current = null;
        lastCompletedSpeechRef.current = null;
        debugVoice("transcript_decision", {
          accepted: decision.accepted,
          reason: decision.accepted ? null : decision.reason,
          sentence,
          lastCompletedSpeech: lastCompletedSpeechRef.current,
          suppressUntilDeltaMs: assistantSuppressUntilRef.current - Date.now(),
        });

        if (!decision.accepted) {
          callbacksRef.current.onTranscriptRejected?.(sentence, decision.reason);
          sendEvent({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify({
                ignored: true,
                reason: decision.reason,
                instruction:
                  "This transcript was rejected by the client as likely echo, silence, or background noise. Do not analyze it and do not update the learner model.",
              }),
            },
          });
          sendEvent({
            type: "response.create",
            response: {
              instructions:
                "The last transcript was rejected as likely echo/noise. Do not speak. Wait silently for the learner's next real utterance.",
            },
          });
          updateState("listening");
          return;
        }
      }

      const res = await fetch("/api/realtime/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: name,
          args: parsedArgs,
          learnerModel: learnerModelRef.current,
          conversationState: convStateRef.current,
          dismissedNudges: dismissedNudgesRef.current,
        }),
      });

      if (!res.ok) throw new Error(`Tool API error: ${res.status}`);
      const data = await res.json();

      // Update learner model if the tool returned updates
      if (data.updatedModel) {
        learnerModelRef.current = data.updatedModel;
        convStateRef.current = data.updatedState;
        callbacksRef.current.onModelUpdate?.(
          data.updatedModel,
          data.updatedState
        );
      }

      // Forward rich analysis for UI rendering
      if (data.turnAnalysis) {
        callbacksRef.current.onTurnAnalysis?.(data.turnAnalysis);
      }

      // Send tool result back to Realtime API
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: data.result,
        },
      });

      // Tell the model to continue responding
      sendEvent({ type: "response.create" });
    } catch (err) {
      console.error("Tool call failed:", err);

      // Commit a placeholder turn so the UI shows SOMETHING rather than
      // staying blank. The learner hears the coach's fallback audio but
      // previously had no written signal that their sentence landed.
      if (name === "analyze_german_sentence") {
        try {
          const parsedArgs = JSON.parse(args) as { sentence?: string };
          const sentence = parsedArgs.sentence ?? "(couldn't transcribe)";
          const convState = convStateRef.current;
          const model = learnerModelRef.current;
          callbacksRef.current.onTurnAnalysis?.({
            sentence,
            responseText:
              "(Analysis couldn't complete in time. I heard you — keep going.)",
            score: 0,
            detectedLevel: model?.detectedLevel ?? "A1",
            tokens: [],
            corrections: [],
            ruleCard: null,
            activeRule: null,
            deepPracticeNudge: null,
            lessonSuggestion: null,
            nextPrompt: "",
            focusStructure: convState?.focusStructure ?? null,
            errorStructureIds: [],
          });
        } catch {
          // Best-effort fallback — ignore if args can't be parsed
        }
      }

      // Send error result so the model can recover
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            error: "Analysis temporarily unavailable. Please continue the conversation naturally.",
          }),
        },
      });
      sendEvent({ type: "response.create" });
    }
  }

  async function analyzeCommittedTranscript(sentence: string) {
    const decision = decideTranscript(sentence);
    currentSpeechRef.current = null;
    lastCompletedSpeechRef.current = null;
    debugVoice("transcript_decision", {
      accepted: decision.accepted,
      reason: decision.accepted ? null : decision.reason,
      sentence,
      suppressUntilDeltaMs: assistantSuppressUntilRef.current - Date.now(),
    });

    if (!decision.accepted) {
      callbacksRef.current.onTranscriptRejected?.(sentence, decision.reason);
      updateState("listening");
      return;
    }

    callbacksRef.current.onUserTranscript?.(sentence, true);
    updateState("thinking");

    try {
      const res = await fetch("/api/realtime/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolName: "analyze_german_sentence",
          args: { sentence },
          learnerModel: learnerModelRef.current,
          conversationState: convStateRef.current,
          dismissedNudges: dismissedNudgesRef.current,
        }),
      });

      if (!res.ok) throw new Error(`Tool API error: ${res.status}`);
      const data = await res.json();

      if (data.updatedModel) {
        learnerModelRef.current = data.updatedModel;
        convStateRef.current = data.updatedState;
        callbacksRef.current.onModelUpdate?.(
          data.updatedModel,
          data.updatedState
        );
      }

      if (data.turnAnalysis) {
        callbacksRef.current.onTurnAnalysis?.(data.turnAnalysis);
      }

      let coachMessage = "";
      try {
        const result = JSON.parse(data.result);
        coachMessage = String(result.coachMessage ?? "");
      } catch {
        coachMessage = data.turnAnalysis?.responseText ?? "";
      }

      if (!coachMessage.trim()) {
        updateState("listening");
        return;
      }

      sendEvent({
        type: "response.create",
        response: {
          instructions:
            "Speak the following tutor response exactly. Do not add a new question. Do not mention hidden analysis or JSON.\n\n" +
            coachMessage,
        },
      });
    } catch (err) {
      console.error("Transcript analysis failed:", err);
      callbacksRef.current.onError?.(
        err instanceof Error ? err.message : "Transcript analysis failed"
      );
      updateState("listening");
    }
  }

  // ── Handle DataChannel events from the Realtime API ──

  function handleDataChannelMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        // ── User speech transcription ──
        case "conversation.item.input_audio_transcription.delta":
          callbacksRef.current.onUserTranscript?.(data.delta ?? "", false);
          break;

        case "conversation.item.input_audio_transcription.completed":
          debugVoice("transcript_completed", { transcript: data.transcript ?? "" });
          analyzeCommittedTranscript(data.transcript ?? "");
          break;

        // ── Model audio response started ──
        case "response.audio.delta":
          if (stateRef.current !== "speaking") {
            assistantSpeakingRef.current = true;
            currentAssistantTextRef.current = "";
            updateState("speaking");
          }
          break;

        // ── Model text response (for display) ──
        case "response.audio_transcript.delta":
          currentAssistantTextRef.current += data.delta ?? "";
          callbacksRef.current.onModelText?.(data.delta ?? "");
          break;

        // ── Tool call arguments streaming ──
        case "response.function_call_arguments.delta": {
          const existing = toolCallsRef.current.get(data.call_id);
          if (existing) {
            existing.arguments += data.delta ?? "";
          } else {
            toolCallsRef.current.set(data.call_id, {
              callId: data.call_id,
              name: data.name ?? "",
              arguments: data.delta ?? "",
            });
          }
          break;
        }

        // ── Tool call complete — execute it ──
        case "response.function_call_arguments.done": {
          const callId = data.call_id;
          const accumulated = toolCallsRef.current.get(callId);
          const name = data.name ?? accumulated?.name ?? "";
          const args = data.arguments ?? accumulated?.arguments ?? "{}";
          toolCallsRef.current.delete(callId);
          handleToolCall(callId, name, args);
          break;
        }

        // ── Response finished ──
        case "response.done":
          finishAssistantAudio();
          if (stateRef.current === "speaking") {
            updateState("listening");
          }
          break;

        case "response.audio.done":
          finishAssistantAudio();
          if (stateRef.current === "speaking") {
            updateState("listening");
          }
          break;

        // ── Input speech started (user is talking) ──
        case "input_audio_buffer.speech_started":
          bumpActivity();
          currentSpeechRef.current = {
            startedAt: Date.now(),
            stoppedAt: null,
            overlappedAssistant:
              assistantSpeakingRef.current || Date.now() < assistantSuppressUntilRef.current,
          };
          debugVoice("speech_started", { ...currentSpeechRef.current });
          break;

        // ── Input speech ended ──
        case "input_audio_buffer.speech_stopped":
          bumpActivity();
          if (currentSpeechRef.current) {
            currentSpeechRef.current.stoppedAt = Date.now();
            lastCompletedSpeechRef.current = currentSpeechRef.current;
            debugVoice("speech_stopped", { ...lastCompletedSpeechRef.current });
          }
          break;

        // ── Session errors ──
        case "error":
          console.error("Realtime API error:", data.error);
          callbacksRef.current.onError?.(
            data.error?.message ?? "Realtime API error"
          );
          break;
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  // ── Token fetch helper (used by both prefetch and connect) ──

  async function fetchEphemeralToken(): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
    } catch {
      // Supabase env may be unset on localhost — proceed without auth header.
    }
    const tokenRes = await fetch("/api/realtime/session", {
      method: "POST",
      headers,
      body: JSON.stringify({ learnerModel: learnerModelRef.current }),
    });
    if (!tokenRes.ok) {
      let reason = `Failed to create session (${tokenRes.status})`;
      try {
        const body = await tokenRes.json();
        if (body?.message) reason = body.message;
        else if (body?.error) reason = body.error;
      } catch {}
      throw new Error(reason);
    }
    const { token } = await tokenRes.json();
    if (!token) throw new Error("No token received");
    return token;
  }

  const prefetchToken = useCallback(async () => {
    if (!learnerModelRef.current) return;
    const cached = prefetchedTokenRef.current;
    if (cached && Date.now() - cached.fetchedAt < TOKEN_FRESHNESS_MS) return;
    try {
      const token = await fetchEphemeralToken();
      prefetchedTokenRef.current = { token, fetchedAt: Date.now() };
    } catch {
      // Silent — connect() will retry on demand
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Connect: fetch token → setup WebRTC → start session ──

  const connect = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!learnerModelRef.current) return;

    updateState("connecting");

    try {
      // 1+2. Fetch token and request mic in parallel — they're independent.
      const cached = prefetchedTokenRef.current;
      const tokenPromise =
        cached && Date.now() - cached.fetchedAt < TOKEN_FRESHNESS_MS
          ? Promise.resolve(cached.token)
          : fetchEphemeralToken();
      const micPromise = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const [token, stream] = await Promise.all([tokenPromise, micPromise]);
      // Token consumed — drop the cache so we don't reuse a stale one.
      prefetchedTokenRef.current = null;
      streamRef.current = stream;

      // 3. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 4. Set up audio playback for model's voice
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioRef.current = audioEl;

      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 5. Add mic audio track
      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // 6. Create DataChannel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        updateState("listening");
        // Auto-disconnect after IDLE_TIMEOUT_MS of silence (no activity events).
        // Frees the realtime credit budget when the user walks away.
        if (idleTimerRef.current) clearInterval(idleTimerRef.current);
        idleTimerRef.current = setInterval(() => {
          if (
            stateRef.current === "listening" &&
            Date.now() - lastActivityRef.current > IDLE_TIMEOUT_MS
          ) {
            cleanup();
            updateState("idle");
          }
        }, 5000);
        // Trigger the model to call get_session_context and greet the user
        sendEvent({
          type: "response.create",
          response: {
            instructions:
              "Call the get_session_context tool to learn about the student, then greet them warmly using the opener from the tool result.",
          },
        });
      };

      dc.onmessage = handleDataChannelMessage;

      dc.onclose = () => {
        if (stateRef.current !== "idle") {
          updateState("idle");
        }
      };

      // 7. Create and set local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 8. Send offer to OpenAI Realtime API, get answer
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2025-06-03",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        const errText = await sdpRes.text();
        throw new Error(`SDP exchange failed: ${sdpRes.status} ${errText}`);
      }

      const answerSDP = await sdpRes.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSDP,
      });
    } catch (err) {
      console.error("Realtime connection failed:", err);
      callbacksRef.current.onError?.(
        err instanceof Error ? err.message : "Connection failed"
      );
      cleanup();
      updateState("idle");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Disconnect and cleanup ──

  function cleanup() {
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (micReenableTimerRef.current) {
      clearTimeout(micReenableTimerRef.current);
      micReenableTimerRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    toolCallsRef.current.clear();
    currentSpeechRef.current = null;
    lastCompletedSpeechRef.current = null;
    assistantSpeakingRef.current = false;
    assistantSuppressUntilRef.current = 0;
    currentAssistantTextRef.current = "";
    recentAssistantTextsRef.current = [];
  }

  const disconnect = useCallback(() => {
    cleanup();
    updateState("idle");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendEventExternal = useCallback((event: Record<string, unknown>) => {
    sendEvent(event);
  }, []);

  return {
    state,
    connect,
    disconnect,
    isSupported,
    sendEvent: sendEventExternal,
    prefetchToken,
  };
}
