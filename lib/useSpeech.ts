"use client";

import { useState, useCallback, useRef } from "react";

type Voice = "nova" | "shimmer" | "alloy" | "echo" | "fable" | "onyx";

interface UseSpeechOptions {
  voice?: Voice;
}

/**
 * Hook for text-to-speech using OpenAI TTS API.
 * Falls back to browser speechSynthesis if the API fails.
 *
 * Voices: nova (warm female), shimmer (soft female), alloy (neutral),
 *         echo (warm male), fable (expressive), onyx (deep male)
 */
export function useSpeech(options: UseSpeechOptions = {}) {
  const { voice = "nova" } = options;
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }

      setSpeaking(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error("TTS API failed");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          audioRef.current = null;
        };

        audio.onerror = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
          audioRef.current = null;
        };

        await audio.play();
      } catch (err) {
        // If aborted, don't fallback
        if (err instanceof DOMException && err.name === "AbortError") {
          setSpeaking(false);
          return;
        }

        // Fallback to browser TTS
        console.warn("OpenAI TTS failed, falling back to browser TTS:", err);
        try {
          const clean = text
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\n/g, ". ");

          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(clean);
          utterance.lang = "de-DE";
          utterance.rate = 0.9;

          // Try to find a German voice
          const voices = speechSynthesis.getVoices();
          const german = voices.find((v) => v.lang.startsWith("de"));
          if (german) utterance.voice = german;

          utterance.onend = () => setSpeaking(false);
          utterance.onerror = () => setSpeaking(false);
          speechSynthesis.speak(utterance);
        } catch {
          setSpeaking(false);
        }
      }
    },
    [voice]
  );

  const stop = useCallback(() => {
    // Stop OpenAI audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    // Stop browser TTS fallback
    if (typeof window !== "undefined" && window.speechSynthesis) {
      speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  // Always supported — we have the API + browser fallback
  return { speak, stop, speaking, supported: true };
}
