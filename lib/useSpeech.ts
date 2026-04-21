"use client";

import { useState, useCallback, useRef } from "react";

type Voice = "nova" | "shimmer" | "alloy" | "echo" | "fable" | "onyx";

interface UseSpeechOptions {
  voice?: Voice;
  /** Coach language name (e.g. "English", "German"). Used for the browser-TTS fallback's lang. */
  language?: string;
  onEnd?: () => void;
}

// Language name → BCP-47 code for the browser-TTS fallback.
// OpenAI tts-1 auto-detects from text; this is only for when that fails.
const LANG_CODE: Record<string, string> = {
  English: "en-US",
  Bengali: "bn-IN",
  German: "de-DE",
  Turkish: "tr-TR",
  Hindi: "hi-IN",
  Spanish: "es-ES",
  French: "fr-FR",
  Italian: "it-IT",
  Portuguese: "pt-PT",
  Dutch: "nl-NL",
  Russian: "ru-RU",
  Japanese: "ja-JP",
  Korean: "ko-KR",
  Chinese: "zh-CN",
  Arabic: "ar-SA",
};

type QueueItem = {
  audioPromise: Promise<HTMLAudioElement | null>;
  controller: AbortController;
};

/**
 * Hook for text-to-speech using OpenAI TTS API.
 *
 * Two playback modes:
 * - `speak(text)`: interrupts everything, plays once, browser-TTS fallback on failure.
 *   Used for manual speak buttons and one-off playback.
 * - `enqueue(text)`: queues a chunk behind anything already playing/queued.
 *   Used for sentence-by-sentence streaming while Claude is still generating.
 *
 * `onEnd` fires whenever playback drains to empty (queue + current).
 */
export function useSpeech(options: UseSpeechOptions = {}) {
  const { voice = "nova", language, onEnd } = options;
  const [speaking, setSpeaking] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);
  // Immediate-path (speak()) state — kept separate so we can abort it cleanly.
  const immediateAbortRef = useRef<AbortController | null>(null);
  const immediateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const languageRef = useRef(language);
  languageRef.current = language;

  const notifyDrained = useCallback(() => {
    setSpeaking(false);
    onEndRef.current?.();
  }, []);

  // Shared fetch — returns a ready-to-play <audio> element, or null on failure.
  async function fetchTTSAudio(
    text: string,
    signal: AbortSignal
  ): Promise<HTMLAudioElement | null> {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voiceRef.current, language: languageRef.current }),
      signal,
    });
    if (!res.ok) throw new Error("TTS API failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    return audio;
  }

  const playNext = useCallback(async () => {
    if (playingRef.current) return;
    const item = queueRef.current.shift();
    if (!item) {
      if (audioRef.current) return; // immediate-path audio still playing
      notifyDrained();
      return;
    }
    playingRef.current = true;
    setSpeaking(true);

    let audio: HTMLAudioElement | null = null;
    try {
      audio = await item.audioPromise;
    } catch {
      audio = null;
    }

    if (!audio || item.controller.signal.aborted) {
      playingRef.current = false;
      playNext();
      return;
    }

    audioRef.current = audio;
    const advance = () => {
      if (audioRef.current === audio) audioRef.current = null;
      playingRef.current = false;
      playNext();
    };
    audio.onended = advance;
    audio.onerror = advance;

    try {
      await audio.play();
    } catch {
      advance();
    }
  }, [notifyDrained]);

  const enqueue = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const controller = new AbortController();
      const audioPromise = fetchTTSAudio(text, controller.signal).catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return null;
        console.warn("TTS chunk failed, skipping:", err);
        return null;
      });
      queueRef.current.push({ audioPromise, controller });
      setSpeaking(true);
      playNext();
    },
    [playNext]
  );

  const cancelAll = useCallback(() => {
    // Abort all queued fetches and clear the queue.
    for (const item of queueRef.current) item.controller.abort();
    queueRef.current = [];
    // Stop any playing audio.
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Abort immediate-path fetch and clear its timeout.
    if (immediateAbortRef.current) {
      immediateAbortRef.current.abort();
      immediateAbortRef.current = null;
    }
    if (immediateTimeoutRef.current) {
      clearTimeout(immediateTimeoutRef.current);
      immediateTimeoutRef.current = null;
    }
    // Stop browser-TTS fallback.
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    playingRef.current = false;
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      cancelAll();
      setSpeaking(true);

      const controller = new AbortController();
      immediateAbortRef.current = controller;

      // Safety timeout: if TTS doesn't finish in 30s, force reset.
      immediateTimeoutRef.current = setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        notifyDrained();
      }, 30000);

      try {
        const audio = await fetchTTSAudio(text, controller.signal);
        if (!audio) throw new Error("no audio");
        audioRef.current = audio;
        const finishImmediate = () => {
          if (immediateTimeoutRef.current) {
            clearTimeout(immediateTimeoutRef.current);
            immediateTimeoutRef.current = null;
          }
          audioRef.current = null;
          // Keep draining queue if anything was added after speak().
          if (queueRef.current.length > 0) playNext();
          else notifyDrained();
        };
        audio.onended = finishImmediate;
        audio.onerror = () => finishImmediate();
        await audio.play();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setSpeaking(false);
          return;
        }

        // Fallback to browser TTS (immediate path only).
        console.warn("OpenAI TTS failed, falling back to browser TTS:", err);
        try {
          const clean = text
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/\n/g, ". ");

          const langCode = languageRef.current
            ? LANG_CODE[languageRef.current] ?? "en-US"
            : "en-US";

          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(clean);
          utterance.lang = langCode;
          utterance.rate = 0.9;

          const voices = speechSynthesis.getVoices();
          const match = voices.find((v) => v.lang.startsWith(langCode.split("-")[0]));
          if (match) utterance.voice = match;

          utterance.onend = () => notifyDrained();
          utterance.onerror = () => notifyDrained();
          speechSynthesis.speak(utterance);
        } catch {
          notifyDrained();
        }
      }
    },
    [cancelAll, notifyDrained, playNext]
  );

  const stop = useCallback(() => {
    cancelAll();
    setSpeaking(false);
  }, [cancelAll]);

  return { speak, enqueue, stop, speaking, supported: true };
}
