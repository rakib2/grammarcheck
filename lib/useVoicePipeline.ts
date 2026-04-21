"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LearnerModel, ConversationState } from "@/types";

// ── Types ──

export type PipelineState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";

interface AudioChunk {
  idx: number;
  data: string; // base64 mp3
}

interface PipelineAnalysis {
  responseText: string;
  corrections: unknown[];
  ruleCard: unknown;
  nextPrompt: string;
  score: number;
  detectedLevel: string;
  tokens: unknown[];
  updatedModel: LearnerModel;
  updatedState: ConversationState;
  lessonSuggestion: unknown;
  activeRule: unknown;
  deepPracticeNudge: unknown;
}

export interface VoicePipelineCallbacks {
  onTranscript?: (text: string) => void;
  onStreamToken?: (text: string) => void;
  onCoachDone?: (text: string) => void;
  onAnalysis?: (data: PipelineAnalysis) => void;
  onError?: (message: string) => void;
  onStateChange?: (state: PipelineState) => void;
}

interface UseVoicePipelineOptions {
  learnerModel: LearnerModel | null;
  conversationState: ConversationState | null;
  persistentErrors?: string[];
  sessionFocus?: string[];
  autoListen?: boolean;
  callbacks: VoicePipelineCallbacks;
}

interface UseVoicePipelineReturn {
  state: PipelineState;
  startListening: () => void;
  stopListening: () => void;
  interrupt: () => void;
  isSupported: boolean;
}

// ── VAD Constants ──
const SILENCE_THRESHOLD = 0.008; // RMS energy below this = silence
const SPEECH_THRESHOLD = 0.015;  // RMS energy above this = speech detected
const SILENCE_DURATION_MS = 1500; // 1.5s silence triggers send
const MIN_RECORDING_MS = 500;     // minimum recording time before silence detection

// ── Hook ──

export function useVoicePipeline(options: UseVoicePipelineOptions): UseVoicePipelineReturn {
  const {
    learnerModel,
    conversationState,
    persistentErrors,
    sessionFocus,
    autoListen = false,
    callbacks,
  } = options;

  const [state, setState] = useState<PipelineState>("IDLE");
  const [isSupported, setIsSupported] = useState(false);

  // Refs for stable access in closures
  const stateRef = useRef<PipelineState>("IDLE");
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const autoListenRef = useRef(autoListen);
  autoListenRef.current = autoListen;
  const learnerModelRef = useRef(learnerModel);
  learnerModelRef.current = learnerModel;
  const convStateRef = useRef(conversationState);
  convStateRef.current = conversationState;
  const persistentErrorsRef = useRef(persistentErrors);
  persistentErrorsRef.current = persistentErrors;
  const sessionFocusRef = useRef(sessionFocus);
  sessionFocusRef.current = sessionFocus;

  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);
  const vadFrameRef = useRef<number>(0);

  // Audio playback refs
  const audioQueueRef = useRef<AudioChunk[]>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function updateState(newState: PipelineState) {
    stateRef.current = newState;
    setState(newState);
    callbacksRef.current.onStateChange?.(newState);
  }

  // Check browser support
  useEffect(() => {
    setIsSupported(
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined" &&
      typeof AudioContext !== "undefined"
    );
  }, []);

  // ── Audio Playback Queue ──
  // Plays base64 mp3 chunks in order, seamlessly

  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    if (audioQueueRef.current.length === 0) {
      // All audio played — transition state
      if (stateRef.current === "SPEAKING") {
        if (autoListenRef.current) {
          updateState("LISTENING");
          startRecording();
        } else {
          updateState("IDLE");
        }
      }
      return;
    }

    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;

    try {
      const audioBytes = atob(chunk.data);
      const audioArray = new Uint8Array(audioBytes.length);
      for (let i = 0; i < audioBytes.length; i++) {
        audioArray[i] = audioBytes.charCodeAt(i);
      }
      const blob = new Blob([audioArray], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          isPlayingRef.current = false;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          isPlayingRef.current = false;
          reject(new Error("Audio playback error"));
        };
        audio.play().catch(reject);
      });

      // Play next chunk
      playNextInQueue();
    } catch (err) {
      console.warn("Audio playback failed:", err);
      isPlayingRef.current = false;
      // Try next chunk
      playNextInQueue();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function enqueueAudio(chunk: AudioChunk) {
    // Insert in order by idx
    const queue = audioQueueRef.current;
    let insertIdx = queue.length;
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].idx > chunk.idx) {
        insertIdx = i;
        break;
      }
    }
    queue.splice(insertIdx, 0, chunk);

    // Start playing if not already
    if (!isPlayingRef.current && stateRef.current === "SPEAKING") {
      playNextInQueue();
    }
  }

  // ── VAD: Energy-based silence detection ──

  function startVAD() {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);
    silenceStartRef.current = null;
    let speechDetected = false; // Only trigger silence AFTER user has spoken

    function checkEnergy() {
      if (stateRef.current !== "LISTENING") return;

      analyser.getFloatTimeDomainData(dataArray);

      // Compute RMS energy
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      const now = Date.now();
      const recordingDuration = now - recordingStartRef.current;

      // Detect speech first — don't trigger silence until user has actually spoken
      if (rms >= SPEECH_THRESHOLD) {
        speechDetected = true;
        silenceStartRef.current = null;
      } else if (rms < SILENCE_THRESHOLD && speechDetected) {
        // Only start silence timer after speech was detected
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
        } else if (
          now - silenceStartRef.current >= SILENCE_DURATION_MS &&
          recordingDuration >= MIN_RECORDING_MS
        ) {
          // Silence after speech — stop and send
          stopRecordingAndSend();
          return;
        }
      }

      vadFrameRef.current = requestAnimationFrame(checkEnergy);
    }

    vadFrameRef.current = requestAnimationFrame(checkEnergy);
  }

  function stopVAD() {
    if (vadFrameRef.current) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = 0;
    }
  }

  // ── Recording ──

  async function startRecording() {
    if (stateRef.current !== "IDLE" && stateRef.current !== "LISTENING") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });
      streamRef.current = stream;

      // Set up AudioContext + AnalyserNode for VAD
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start(100); // collect chunks every 100ms
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();

      updateState("LISTENING");
      startVAD();
    } catch (err) {
      console.error("Microphone access failed:", err);
      callbacksRef.current.onError?.("Microphone access denied");
      updateState("IDLE");
    }
  }

  function stopRecordingCleanup() {
    stopVAD();

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }
  }

  async function stopRecordingAndSend() {
    if (stateRef.current !== "LISTENING") return;

    updateState("PROCESSING");
    stopVAD();

    // Stop recorder and wait for final data
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      updateState("IDLE");
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    // Clean up mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }
    mediaRecorderRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (chunks.length === 0) {
      callbacksRef.current.onError?.("No audio recorded");
      updateState("IDLE");
      return;
    }

    const audioBlob = new Blob(chunks, { type: "audio/webm;codecs=opus" });

    // Don't send very short recordings (likely noise)
    if (audioBlob.size < 1000) {
      updateState(autoListenRef.current ? "LISTENING" : "IDLE");
      if (autoListenRef.current) startRecording();
      return;
    }

    // Send to pipeline
    await sendToPipeline(audioBlob);
  }

  // ── Pipeline Call ──

  async function sendToPipeline(audioBlob: Blob) {
    const model = learnerModelRef.current;
    const convState = convStateRef.current;
    if (!model || !convState) {
      callbacksRef.current.onError?.("No learner model or conversation state");
      updateState("IDLE");
      return;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob);
      formData.append("learnerModel", JSON.stringify(model));
      formData.append("conversationState", JSON.stringify(convState));
      if (persistentErrorsRef.current?.length) {
        formData.append("persistentErrors", JSON.stringify(persistentErrorsRef.current));
      }
      if (sessionFocusRef.current?.length) {
        formData.append("sessionFocus", JSON.stringify(sessionFocusRef.current));
      }

      const res = await fetch("/api/voice/pipeline", {
        method: "POST",
        body: formData,
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`Pipeline request failed: ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let hasTransitioned = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);

            switch (event.type) {
              case "transcript":
                callbacksRef.current.onTranscript?.(event.text);
                break;

              case "token":
                callbacksRef.current.onStreamToken?.(event.text);
                break;

              case "audio":
                // Transition to SPEAKING on first audio chunk
                if (!hasTransitioned) {
                  updateState("SPEAKING");
                  hasTransitioned = true;
                }
                enqueueAudio({ idx: event.idx, data: event.data });
                break;

              case "coachDone":
                callbacksRef.current.onCoachDone?.(event.text);
                // If no audio chunks arrived yet, transition to speaking
                // (the audio will arrive shortly)
                if (!hasTransitioned) {
                  updateState("SPEAKING");
                  hasTransitioned = true;
                }
                break;

              case "analysis":
                callbacksRef.current.onAnalysis?.(event.data);
                break;

              case "done":
                // All audio chunks sent — start playback if not already
                if (!isPlayingRef.current && audioQueueRef.current.length > 0) {
                  playNextInQueue();
                }
                break;

              case "error":
                callbacksRef.current.onError?.(event.message);
                if (!hasTransitioned) {
                  updateState("IDLE");
                }
                break;
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      // If no audio was received at all, transition back
      if (!hasTransitioned) {
        updateState(autoListenRef.current ? "LISTENING" : "IDLE");
        if (autoListenRef.current) startRecording();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Pipeline error:", err);
      callbacksRef.current.onError?.(err instanceof Error ? err.message : "Pipeline failed");
      updateState("IDLE");
    }
  }

  // ── Public API ──

  const startListening = useCallback(() => {
    if (stateRef.current !== "IDLE") return;
    startRecording();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopListening = useCallback(() => {
    if (stateRef.current === "LISTENING") {
      stopRecordingAndSend();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const interrupt = useCallback(() => {
    // Stop everything — audio playback, recording, pipeline request
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    stopRecordingCleanup();
    updateState("IDLE");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecordingCleanup();
      stopVAD();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    startListening,
    stopListening,
    interrupt,
    isSupported,
  };
}
