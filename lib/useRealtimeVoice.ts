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

export interface RealtimeCallbacks {
  /** User's speech transcribed */
  onUserTranscript?: (text: string, isFinal: boolean) => void;
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

  const [isSupported] = useState(
    typeof window !== "undefined" &&
      typeof RTCPeerConnection !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
  );

  function updateState(s: RealtimeState) {
    stateRef.current = s;
    setState(s);
    callbacksRef.current.onStateChange?.(s);
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
          callbacksRef.current.onUserTranscript?.(data.transcript ?? "", true);
          break;

        // ── Model audio response started ──
        case "response.audio.delta":
          if (stateRef.current !== "speaking") {
            updateState("speaking");
          }
          break;

        // ── Model text response (for display) ──
        case "response.audio_transcript.delta":
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
          if (stateRef.current === "speaking") {
            updateState("listening");
          }
          break;

        // ── Input speech started (user is talking) ──
        case "input_audio_buffer.speech_started":
          // Could update UI to show "user is speaking"
          break;

        // ── Input speech ended ──
        case "input_audio_buffer.speech_stopped":
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

  // ── Connect: fetch token → setup WebRTC → start session ──

  const connect = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (!learnerModelRef.current) return;

    updateState("connecting");

    try {
      // 1. Get ephemeral token from our server. Forward the user's Supabase
      //    access token so the server can enforce the per-user daily cap.
      //    On localhost (no session) the server skips enforcement.
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
        body: JSON.stringify({
          learnerModel: learnerModelRef.current,
        }),
      });

      if (!tokenRes.ok) {
        // Surface the server's reason (e.g. daily cap) rather than a generic fail
        let reason = `Failed to create session (${tokenRes.status})`;
        try {
          const body = await tokenRes.json();
          if (body?.message) reason = body.message;
          else if (body?.error) reason = body.error;
        } catch {
          // ignore — keep generic reason
        }
        throw new Error(reason);
      }
      const { token } = await tokenRes.json();
      if (!token) throw new Error("No token received");

      // 2. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
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
  };
}
