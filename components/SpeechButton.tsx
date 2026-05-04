"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface SpeechButtonProps {
  onResult: (text: string) => void;
  onInterim?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  disabled?: boolean;
  voiceMode?: boolean;
  /** When this transitions false→true, auto-start the mic (used by autoListen after TTS) */
  autoStart?: boolean;
}

// Trigger words that signal the user is done speaking and wants analysis
const SUBMIT_TRIGGERS = /\b(done|okay|ok|fertig|analyse|analyze|check|prüf)\b/i;

/** Silence after a final transcript chunk before we auto-submit. */
const AUTO_SUBMIT_DELAY_MS = 2500;

/**
 * Continuous speech recognition button.
 *
 * UX contract — there is no "Use / Clear" two-step. Speak, stop talking, and
 * we auto-submit. The button is the abort: tap-to-stop while empty just
 * cancels the listener.
 *
 * - Tap mic → starts listening
 * - Stop talking for {@link AUTO_SUBMIT_DELAY_MS} → auto-submit
 * - Tap mic again → submits whatever's been transcribed (or cancels if empty)
 * - Trigger words ("done", "okay", "fertig", "analyse") submit immediately
 * - Voice mode is unchanged: continuous listening, sends on natural pauses
 */
export default function SpeechButton({ onResult, onInterim, onListeningChange, disabled, voiceMode, autoStart }: SpeechButtonProps) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [interim, setInterim] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAutoStartRef = useRef(false);
  const listeningRef = useRef(false);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  // Notify parent when listening state changes
  useEffect(() => {
    onListeningChange?.(listening);
    listeningRef.current = listening;
  }, [listening, onListeningChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    recognitionRef.current?.stop();
    setListening(false);
    // Tap-to-stop = submit immediately. No draft review step. If nothing was
    // captured, the tap acts as a quiet cancel.
    const text = (transcriptRef.current.trim() || interim.trim()).trim();
    transcriptRef.current = "";
    setInterim("");
    if (text) onResult(text);
  }, [interim, onResult]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    transcriptRef.current = "";
    setInterim("");

    const recognition = new SR();
    recognition.lang = "de-DE";
    recognition.continuous = true;        // Keep listening across pauses
    recognition.interimResults = true;    // Show live transcript
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        } else {
          interimText += result[0].transcript;
        }
      }

      if (finalText) {
        transcriptRef.current = finalText.trim();
      }

      // Show interim text to user
      const display = (finalText + interimText).trim();
      setInterim(display);
      onInterim?.(display);

      // Check for trigger words — submit immediately if user says "done", "okay", etc.
      if (finalText.trim() && SUBMIT_TRIGGERS.test(finalText)) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        const cleanText = transcriptRef.current.replace(SUBMIT_TRIGGERS, "").trim();
        if (cleanText) {
          onResult(cleanText);
          transcriptRef.current = "";
          setInterim("");
          if (!voiceMode) {
            recognitionRef.current?.stop();
            setListening(false);
          }
        }
        return;
      }

      // Auto-submit after AUTO_SUBMIT_DELAY_MS of silence following a final
      // chunk. Same path for voice and non-voice mode now — no draft step.
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (finalText.trim()) {
        silenceTimerRef.current = setTimeout(() => {
          const text = transcriptRef.current.trim();
          if (!text) return;
          onResult(text);
          transcriptRef.current = "";
          setInterim("");
          if (!voiceMode) {
            recognitionRef.current?.stop();
            setListening(false);
          }
        }, AUTO_SUBMIT_DELAY_MS);
      }
    };

    recognition.onerror = (event: Event) => {
      // Don't stop on 'no-speech' — just keep listening
      const err = event as { error?: string };
      if (err.error === "no-speech") return;
      setListening(false);
      setInterim("");
    };

    recognition.onend = () => {
      // In voice mode, auto-restart if we're still supposed to be listening
      if (voiceMode && listeningRef.current) {
        try {
          recognition.start();
        } catch {
          setListening(false);
        }
        return;
      }

      // Non-voice mode: if the recognizer ended on its own with text in flight,
      // submit it directly. Mirrors the auto-submit policy on silence.
      const text = transcriptRef.current.trim();
      if (text) {
        transcriptRef.current = "";
        onResult(text);
      }
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [onResult, onInterim, voiceMode]);

  const toggle = useCallback(() => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [listening, stopListening, startListening]);

  // Auto-start mic when parent requests (rising edge only)
  // This fires when autoListen kicks in after TTS finishes
  useEffect(() => {
    const wasOff = !prevAutoStartRef.current;
    prevAutoStartRef.current = !!autoStart;
    if (autoStart && wasOff && !listening && !disabled) {
      startListening();
    }
  }, [autoStart, listening, disabled, startListening]);

  if (!supported) return null;

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={toggle}
        disabled={disabled}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all ${
          listening
            ? "bg-red-500 text-white shadow-lg shadow-red-200"
            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title={listening ? "Stop" : "Speak in German"}
      >
        {listening ? (
          // Animated mic icon when recording
          <div className="relative">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-white animate-ping" />
          </div>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
      {/* Live transcript preview while listening. No Use/Clear — auto-submit
          on silence or on tap-to-stop. */}
      {listening && (
        <div className="max-w-[240px] rounded-lg bg-gray-900/90 px-2 py-1.5 text-center text-[10px] text-white">
          {interim
            ? interim.length > 90
              ? `${interim.slice(-90)}...`
              : interim
            : "Listening..."}
        </div>
      )}
    </div>
  );
}
