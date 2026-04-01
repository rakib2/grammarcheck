"use client";

import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Voice coordination state machine.
 *
 * Prevents mic/TTS overlap by gating transitions:
 *
 *   IDLE → RECORDING → PROCESSING → SPEAKING → IDLE
 *
 *   IDLE:       mic button available, TTS silent
 *   RECORDING:  mic active, TTS BLOCKED (cannot start)
 *   PROCESSING: mic off, waiting for AI response
 *   SPEAKING:   TTS playing, mic BLOCKED (cannot start)
 *
 *   Auto-listen: when enabled, SPEAKING → RECORDING (after TTS finishes)
 */

export type VoiceState = "IDLE" | "RECORDING" | "PROCESSING" | "SPEAKING";

interface UseVoiceStateOptions {
  autoListen?: boolean;
}

interface UseVoiceStateReturn {
  state: VoiceState;
  canRecord: boolean;
  canSpeak: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  startProcessing: () => void;
  startSpeaking: () => void;
  finishSpeaking: () => void;
  reset: () => void;
}

export function useVoiceState(options: UseVoiceStateOptions = {}): UseVoiceStateReturn {
  const { autoListen = false } = options;
  const [state, setState] = useState<VoiceState>("IDLE");
  const autoListenRef = useRef(autoListen);

  useEffect(() => {
    autoListenRef.current = autoListen;
  }, [autoListen]);

  const canRecord = state === "IDLE";
  const canSpeak = state === "IDLE" || state === "PROCESSING";

  const startRecording = useCallback(() => {
    setState((prev) => {
      if (prev !== "IDLE") return prev; // Gate: only from IDLE
      return "RECORDING";
    });
  }, []);

  const stopRecording = useCallback(() => {
    setState((prev) => {
      if (prev !== "RECORDING") return prev;
      return "IDLE";
    });
  }, []);

  const startProcessing = useCallback(() => {
    setState((prev) => {
      if (prev !== "RECORDING" && prev !== "IDLE") return prev;
      return "PROCESSING";
    });
  }, []);

  const startSpeaking = useCallback(() => {
    setState((prev) => {
      if (prev === "RECORDING") return prev; // Never interrupt recording
      return "SPEAKING";
    });
  }, []);

  const finishSpeaking = useCallback(() => {
    setState(() => {
      if (autoListenRef.current) {
        return "RECORDING"; // Auto-listen: go straight to recording
      }
      return "IDLE";
    });
  }, []);

  const reset = useCallback(() => {
    setState("IDLE");
  }, []);

  return {
    state,
    canRecord,
    canSpeak,
    startRecording,
    stopRecording,
    startProcessing,
    startSpeaking,
    finishSpeaking,
    reset,
  };
}
