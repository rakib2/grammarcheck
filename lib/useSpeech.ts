"use client";

import { useState, useCallback, useRef } from "react";

type Voice = "nova" | "shimmer" | "alloy" | "echo" | "fable" | "onyx";

interface UseSpeechOptions {
  voice?: Voice;
  onEnd?: () => void;
}

/**
 * Hook for text-to-speech using OpenAI TTS API.
 * Falls back to browser speechSynthesis if the API fails.
 *
 * Voices: nova (warm female), shimmer (soft female), alloy (neutral),
 *         echo (warm male), fable (expressive), onyx (deep male)
 */
export function useSpeech(options: UseSpeechOptions = {}) {
  const { voice = "nova", onEnd } = options;
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const markDone = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSpeaking(false);
    onEndRef.current?.();
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Stop any currently playing audio — OpenAI element AND browser TTS.
      // The browser-TTS fallback wasn't being cancelled here, so a stale
      // utterance could keep speaking while the next OpenAI audio started,
      // producing an echo / doubled voice.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      setSpeaking(true);
      const controller = new AbortController();
      abortRef.current = controller;

      // Safety timeout: if TTS doesn't finish in 30s, force reset
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        markDone();
      }, 30000);

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
          URL.revokeObjectURL(url);
          audioRef.current = null;
          markDone();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          markDone();
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

          utterance.onend = () => markDone();
          utterance.onerror = () => markDone();
          speechSynthesis.speak(utterance);
        } catch {
          markDone();
        }
      }
    },
    [voice, markDone]
  );

  const stop = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
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
